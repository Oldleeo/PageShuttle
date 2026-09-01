using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http.Headers;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using PageShuttle.Shared;

namespace ChromeOnlyProxy.Host;

internal sealed class UpdateManager
{
    internal const string FeedUrl = "https://github.com/Oldleeo/PageShuttle/releases/latest/download/update-manifest.json";
    private const long MaximumPackageBytes = 300L * 1024 * 1024;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly HttpClient _httpClient;

    public UpdateManager()
    {
        _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        _httpClient.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("PageShuttle", CurrentVersion));
    }

    internal static string CurrentVersion =>
        Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
        ?? Assembly.GetExecutingAssembly().GetName().Version?.ToString(3)
        ?? "0.0.0";

    public async Task<UpdateCheckResult> CheckAsync(CancellationToken cancellationToken = default)
    {
        using var response = await _httpClient.GetAsync(FeedUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        var manifest = await JsonSerializer.DeserializeAsync<UpdateManifest>(stream, JsonOptions, cancellationToken)
            ?? throw new InvalidOperationException("更新清单为空");
        var package = ValidateManifest(manifest);
        return new UpdateCheckResult(IsNewer(manifest.Version, CurrentVersion), CurrentVersion, manifest, package);
    }

    public async Task<UpdateInstallResult> PrepareInstallAsync(XrayManager manager, CancellationToken cancellationToken = default)
    {
        var check = await CheckAsync(cancellationToken);
        if (!check.Available) throw new InvalidOperationException("当前已经是最新版本");

        var installRoot = ResolveInstallRoot();
        var updateRoot = Path.Combine(installRoot, "updates", $"v{check.Manifest.Version}-{Guid.NewGuid():N}");
        var zipPath = Path.Combine(updateRoot, "package.zip");
        var extractRoot = Path.Combine(updateRoot, "staged");
        Directory.CreateDirectory(updateRoot);

        try
        {
            await DownloadAsync(check.Package.PackageUrl, zipPath, cancellationToken);
            var hash = await ComputeSha256Async(zipPath, cancellationToken);
            if (!hash.Equals(check.Package.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new CryptographicException("更新包 SHA-256 校验失败");
            VerifySignature(hash, check.Package.Signature);
            ExtractSafely(zipPath, extractRoot);
            var packageRoot = FindPackageRoot(extractRoot);
            EnsurePackageExecutables(packageRoot);
            ValidatePackage(packageRoot, check.Manifest.Version);

            manager.Stop();
            var updaterName = PlatformPaths.ExecutableName("PageShuttleUpdater");
            var updaterSource = Path.Combine(packageRoot, "helper", updaterName);
            var updaterCopy = Path.Combine(Path.GetTempPath(), $"PageShuttleUpdater-{Guid.NewGuid():N}{(OperatingSystem.IsWindows() ? ".exe" : string.Empty)}");
            File.Copy(updaterSource, updaterCopy, overwrite: false);
            PlatformPaths.EnsureExecutable(updaterCopy);

            var plan = new UpdatePlan
            {
                InstallRoot = installRoot,
                PackageRoot = packageRoot,
                UpdateRoot = updateRoot,
                TargetVersion = check.Manifest.Version,
                ParentProcessId = Environment.ProcessId
            };
            var planPath = Path.Combine(updateRoot, "update-plan.json");
            await File.WriteAllTextAsync(planPath, JsonSerializer.Serialize(plan, JsonOptions), cancellationToken);

            var startInfo = new ProcessStartInfo
            {
                FileName = updaterCopy,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                WorkingDirectory = Path.GetDirectoryName(updaterCopy)!
            };
            startInfo.ArgumentList.Add("--apply");
            startInfo.ArgumentList.Add(planPath);
            Process.Start(startInfo)?.Dispose();
            return new UpdateInstallResult(true, check.Manifest.Version, check.Manifest.ReleasePage);
        }
        catch
        {
            TryDeleteDirectory(updateRoot);
            throw;
        }
    }

    public object? ReadLastResult()
    {
        var resultPath = Path.Combine(PlatformPaths.InstallRoot, "update-result.json");
        if (!File.Exists(resultPath)) return null;
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(resultPath));
            return document.RootElement.Clone();
        }
        catch { return null; }
    }

    internal static bool IsNewer(string candidate, string current)
    {
        if (!Version.TryParse(candidate, out var candidateVersion)) throw new InvalidOperationException("远程版本号无效");
        if (!Version.TryParse(current.Split('+')[0], out var currentVersion)) return true;
        return candidateVersion > currentVersion;
    }

    private static string ResolveInstallRoot()
    {
        var baseDirectory = Path.GetFullPath(AppContext.BaseDirectory).TrimEnd(Path.DirectorySeparatorChar);
        var helperName = Path.GetFileName(baseDirectory);
        if (!helperName.Equals("helper", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("页梭本地助手不在标准安装目录，请重新运行安装程序");
        var installRoot = Directory.GetParent(baseDirectory)?.FullName
            ?? throw new InvalidOperationException("无法确定页梭安装目录");
        var expected = Path.GetFullPath(PlatformPaths.InstallRoot);
        if (!installRoot.Equals(expected, PlatformPaths.PathComparison))
            throw new InvalidOperationException("更新仅支持页梭默认安装目录");
        return installRoot;
    }

    private async Task DownloadAsync(string url, string destination, CancellationToken cancellationToken)
    {
        var uri = new Uri(url, UriKind.Absolute);
        if (uri.Scheme != Uri.UriSchemeHttps || !IsAllowedDownloadHost(uri.Host))
            throw new InvalidOperationException("更新包下载地址不受信任");
        using var response = await _httpClient.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength is > MaximumPackageBytes)
            throw new InvalidOperationException("更新包超过大小限制");
        await using var input = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var output = File.Create(destination);
        var buffer = new byte[81920];
        long total = 0;
        int read;
        while ((read = await input.ReadAsync(buffer, cancellationToken)) > 0)
        {
            total += read;
            if (total > MaximumPackageBytes) throw new InvalidOperationException("更新包超过大小限制");
            await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
        }
    }

    private static bool IsAllowedDownloadHost(string host) => host.Equals("github.com", StringComparison.OrdinalIgnoreCase)
        || host.EndsWith(".githubusercontent.com", StringComparison.OrdinalIgnoreCase);

    private static async Task<string> ComputeSha256Async(string path, CancellationToken cancellationToken)
    {
        await using var stream = File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexString(hash);
    }

    private static void VerifySignature(string hashHex, string signatureBase64)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var resourceName = assembly.GetManifestResourceNames().Single(name => name.EndsWith("UpdatePublicKey.pem", StringComparison.Ordinal));
        using var stream = assembly.GetManifestResourceStream(resourceName) ?? throw new InvalidOperationException("缺少更新验证公钥");
        using var reader = new StreamReader(stream);
        using var rsa = RSA.Create();
        rsa.ImportFromPem(reader.ReadToEnd());
        var signature = Convert.FromBase64String(signatureBase64);
        var hash = Convert.FromHexString(hashHex);
        if (!rsa.VerifyHash(hash, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pss))
            throw new CryptographicException("更新包数字签名无效");
    }

    private static void ExtractSafely(string zipPath, string destination)
    {
        Directory.CreateDirectory(destination);
        var destinationRoot = Path.GetFullPath(destination) + Path.DirectorySeparatorChar;
        using var archive = ZipFile.OpenRead(zipPath);
        foreach (var entry in archive.Entries)
        {
            var target = Path.GetFullPath(Path.Combine(destination, entry.FullName));
            if (!target.StartsWith(destinationRoot, PlatformPaths.PathComparison))
                throw new InvalidDataException("更新包包含非法路径");
            if (string.IsNullOrEmpty(entry.Name))
            {
                Directory.CreateDirectory(target);
                continue;
            }
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            entry.ExtractToFile(target, overwrite: true);
        }
    }

    private static string FindPackageRoot(string extractRoot)
    {
        if (File.Exists(Path.Combine(extractRoot, "extension", "manifest.json"))) return extractRoot;
        var candidates = Directory.GetDirectories(extractRoot)
            .Where(path => File.Exists(Path.Combine(path, "extension", "manifest.json")))
            .ToArray();
        return candidates.Length == 1 ? candidates[0] : throw new InvalidDataException("无法识别更新包目录结构");
    }

    private static void ValidatePackage(string packageRoot, string targetVersion)
    {
        var manifestPath = Path.Combine(packageRoot, "extension", "manifest.json");
        using var manifest = JsonDocument.Parse(File.ReadAllText(manifestPath));
        var version = manifest.RootElement.GetProperty("version").GetString();
        if (!string.Equals(version, targetVersion, StringComparison.Ordinal))
            throw new InvalidDataException("更新包版本与更新清单不一致");
        var helperName = PlatformPaths.ExecutableName("ChromeProxyHost");
        var updaterName = PlatformPaths.ExecutableName("PageShuttleUpdater");
        var xrayName = PlatformPaths.ExecutableName("xray");
        foreach (var required in new[]
        {
            Path.Combine(packageRoot, "helper", helperName),
            Path.Combine(packageRoot, "helper", updaterName),
            Path.Combine(packageRoot, "helper", "xray", xrayName)
        })
        {
            if (!File.Exists(required)) throw new InvalidDataException($"更新包缺少 {Path.GetFileName(required)}");
        }
    }

    private static UpdatePackage ValidateManifest(UpdateManifest manifest)
    {
        _ = new Version(manifest.Version);
        if (string.IsNullOrWhiteSpace(manifest.ReleasePage))
            throw new InvalidDataException("更新清单缺少发布页面");

        UpdatePackage package;
        if (manifest.Packages.TryGetValue(PlatformPaths.RuntimeIdentifier, out var platformPackage))
        {
            package = platformPackage;
        }
        else if (PlatformPaths.RuntimeIdentifier == "win-x64")
        {
            package = new UpdatePackage
            {
                PackageUrl = manifest.PackageUrl,
                Sha256 = manifest.Sha256,
                Signature = manifest.Signature
            };
        }
        else
        {
            throw new InvalidDataException($"更新清单不包含 {PlatformPaths.RuntimeIdentifier} 安装包");
        }

        if (string.IsNullOrWhiteSpace(package.PackageUrl))
            throw new InvalidDataException("更新清单缺少下载地址");
        if (package.Sha256.Length != 64 || !package.Sha256.All(Uri.IsHexDigit))
            throw new InvalidDataException("更新清单 SHA-256 无效");
        if (string.IsNullOrWhiteSpace(package.Signature)) throw new InvalidDataException("更新清单缺少数字签名");
        return package;
    }

    private static void EnsurePackageExecutables(string packageRoot)
    {
        if (OperatingSystem.IsWindows()) return;
        PlatformPaths.EnsureExecutable(Path.Combine(packageRoot, "helper", PlatformPaths.ExecutableName("ChromeProxyHost")));
        PlatformPaths.EnsureExecutable(Path.Combine(packageRoot, "helper", PlatformPaths.ExecutableName("PageShuttleUpdater")));
        PlatformPaths.EnsureExecutable(Path.Combine(packageRoot, "helper", "xray", PlatformPaths.ExecutableName("xray")));
    }

    private static void TryDeleteDirectory(string path)
    {
        try { if (Directory.Exists(path)) Directory.Delete(path, recursive: true); } catch { }
    }
}

internal sealed record UpdateCheckResult(bool Available, string CurrentVersion, UpdateManifest Manifest, UpdatePackage Package);
internal sealed record UpdateInstallResult(bool Installing, string Version, string ReleasePage);

internal sealed class UpdateManifest
{
    [JsonPropertyName("version")] public string Version { get; set; } = string.Empty;
    [JsonPropertyName("publishedAt")] public string PublishedAt { get; set; } = string.Empty;
    [JsonPropertyName("packageUrl")] public string PackageUrl { get; set; } = string.Empty;
    [JsonPropertyName("sha256")] public string Sha256 { get; set; } = string.Empty;
    [JsonPropertyName("signature")] public string Signature { get; set; } = string.Empty;
    [JsonPropertyName("releasePage")] public string ReleasePage { get; set; } = string.Empty;
    [JsonPropertyName("notes")] public string[] Notes { get; set; } = [];
    [JsonPropertyName("packages")] public Dictionary<string, UpdatePackage> Packages { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

internal sealed class UpdatePackage
{
    [JsonPropertyName("packageUrl")] public string PackageUrl { get; set; } = string.Empty;
    [JsonPropertyName("sha256")] public string Sha256 { get; set; } = string.Empty;
    [JsonPropertyName("signature")] public string Signature { get; set; } = string.Empty;
}

internal sealed class UpdatePlan
{
    public string InstallRoot { get; set; } = string.Empty;
    public string PackageRoot { get; set; } = string.Empty;
    public string UpdateRoot { get; set; } = string.Empty;
    public string TargetVersion { get; set; } = string.Empty;
    public int ParentProcessId { get; set; }
}
