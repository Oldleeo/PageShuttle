using System.Diagnostics;
using System.Text.Json;

namespace PageShuttle.Updater;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public static async Task<int> Main(string[] args)
    {
        if (args.Length == 1 && args[0].Equals("--self-test", StringComparison.OrdinalIgnoreCase))
            return await RunSelfTestAsync();
        if (args.Length != 2 || !args[0].Equals("--apply", StringComparison.OrdinalIgnoreCase)) return 2;
        try
        {
            var planPath = Path.GetFullPath(args[1]);
            var plan = JsonSerializer.Deserialize<UpdatePlan>(await File.ReadAllTextAsync(planPath), JsonOptions)
                ?? throw new InvalidDataException("更新计划为空");
            await ApplyAsync(plan, validateProductionPaths: true);
            return 0;
        }
        catch (Exception ex)
        {
            try
            {
                var fallback = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Oldlee", "ChromeOnlyProxy", "update-result.json");
                await WriteResultAsync(fallback, false, string.Empty, ex.Message);
            }
            catch { }
            return 1;
        }
    }

    private static async Task ApplyAsync(UpdatePlan plan, bool validateProductionPaths)
    {
        if (validateProductionPaths) ValidatePlan(plan);
        await WaitForParentAsync(plan.ParentProcessId, TimeSpan.FromSeconds(20));

        var extension = Path.Combine(plan.InstallRoot, "extension");
        var helper = Path.Combine(plan.InstallRoot, "helper");
        var newExtension = Path.Combine(plan.PackageRoot, "extension");
        var newHelper = Path.Combine(plan.PackageRoot, "helper");
        var backupRoot = Path.Combine(plan.InstallRoot, "backups", $"before-v{plan.TargetVersion}-{DateTime.UtcNow:yyyyMMddHHmmss}");
        var resultPath = Path.Combine(plan.InstallRoot, "update-result.json");
        Directory.CreateDirectory(backupRoot);

        var extensionBackedUp = false;
        var helperBackedUp = false;
        try
        {
            if (Directory.Exists(extension))
            {
                Directory.Move(extension, Path.Combine(backupRoot, "extension"));
                extensionBackedUp = true;
            }
            if (Directory.Exists(helper))
            {
                Directory.Move(helper, Path.Combine(backupRoot, "helper"));
                helperBackedUp = true;
            }
            Directory.Move(newExtension, extension);
            Directory.Move(newHelper, helper);
            await WriteResultAsync(resultPath, true, plan.TargetVersion, "更新完成");
            PruneBackups(Path.Combine(plan.InstallRoot, "backups"), keep: 2);
            TryDeleteDirectory(plan.UpdateRoot);
        }
        catch (Exception ex)
        {
            TryDeleteDirectory(extension);
            TryDeleteDirectory(helper);
            if (extensionBackedUp) Directory.Move(Path.Combine(backupRoot, "extension"), extension);
            if (helperBackedUp) Directory.Move(Path.Combine(backupRoot, "helper"), helper);
            await WriteResultAsync(resultPath, false, plan.TargetVersion, $"更新失败，已回滚：{ex.Message}");
            throw;
        }
    }

    private static void ValidatePlan(UpdatePlan plan)
    {
        var expected = Path.GetFullPath(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Oldlee", "ChromeOnlyProxy"));
        var installRoot = Path.GetFullPath(plan.InstallRoot);
        if (!installRoot.Equals(expected, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("安装目录校验失败");
        var updateRoot = Path.GetFullPath(plan.UpdateRoot);
        var updatesBase = Path.GetFullPath(Path.Combine(expected, "updates")) + Path.DirectorySeparatorChar;
        if (!updateRoot.StartsWith(updatesBase, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("更新暂存目录校验失败");
        var packageRoot = Path.GetFullPath(plan.PackageRoot);
        if (!packageRoot.StartsWith(updateRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("更新包目录校验失败");
        if (!File.Exists(Path.Combine(packageRoot, "extension", "manifest.json"))
            || !File.Exists(Path.Combine(packageRoot, "helper", "ChromeProxyHost.exe")))
            throw new InvalidDataException("更新包不完整");
    }

    private static async Task WaitForParentAsync(int processId, TimeSpan timeout)
    {
        if (processId <= 0) return;
        try
        {
            using var process = Process.GetProcessById(processId);
            using var cancellation = new CancellationTokenSource(timeout);
            await process.WaitForExitAsync(cancellation.Token);
        }
        catch (ArgumentException) { }
        catch (OperationCanceledException) { throw new TimeoutException("旧版本地助手未能退出"); }
    }

    private static Task WriteResultAsync(string path, bool success, string version, string message)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        return File.WriteAllTextAsync(path, JsonSerializer.Serialize(new
        {
            success,
            version,
            message,
            completedAt = DateTimeOffset.UtcNow
        }, JsonOptions));
    }

    private static void PruneBackups(string root, int keep)
    {
        if (!Directory.Exists(root)) return;
        foreach (var directory in new DirectoryInfo(root).GetDirectories().OrderByDescending(item => item.CreationTimeUtc).Skip(keep))
            TryDeleteDirectory(directory.FullName);
    }

    private static void TryDeleteDirectory(string path)
    {
        try { if (Directory.Exists(path)) Directory.Delete(path, recursive: true); } catch { }
    }

    private static async Task<int> RunSelfTestAsync()
    {
        var root = Path.Combine(Path.GetTempPath(), $"pageshuttle-updater-selftest-{Guid.NewGuid():N}");
        try
        {
            var extension = Path.Combine(root, "extension");
            var helper = Path.Combine(root, "helper");
            Directory.CreateDirectory(extension);
            Directory.CreateDirectory(helper);
            await File.WriteAllTextAsync(Path.Combine(extension, "version.txt"), "old-extension");
            await File.WriteAllTextAsync(Path.Combine(helper, "version.txt"), "old-helper");

            var updateRoot = Path.Combine(root, "updates", "success");
            var packageRoot = Path.Combine(updateRoot, "package");
            Directory.CreateDirectory(Path.Combine(packageRoot, "extension"));
            Directory.CreateDirectory(Path.Combine(packageRoot, "helper"));
            await File.WriteAllTextAsync(Path.Combine(packageRoot, "extension", "version.txt"), "new-extension");
            await File.WriteAllTextAsync(Path.Combine(packageRoot, "helper", "version.txt"), "new-helper");
            await ApplyAsync(new UpdatePlan
            {
                InstallRoot = root, PackageRoot = packageRoot, UpdateRoot = updateRoot,
                TargetVersion = "0.5.1", ParentProcessId = 0
            }, validateProductionPaths: false);
            if (await File.ReadAllTextAsync(Path.Combine(extension, "version.txt")) != "new-extension") return 1;
            if (await File.ReadAllTextAsync(Path.Combine(helper, "version.txt")) != "new-helper") return 1;

            var failingUpdateRoot = Path.Combine(root, "updates", "rollback");
            var failingPackageRoot = Path.Combine(failingUpdateRoot, "package");
            Directory.CreateDirectory(Path.Combine(failingPackageRoot, "extension"));
            await File.WriteAllTextAsync(Path.Combine(failingPackageRoot, "extension", "version.txt"), "broken-extension");
            try
            {
                await ApplyAsync(new UpdatePlan
                {
                    InstallRoot = root, PackageRoot = failingPackageRoot, UpdateRoot = failingUpdateRoot,
                    TargetVersion = "0.5.2", ParentProcessId = 0
                }, validateProductionPaths: false);
                return 1;
            }
            catch { }
            if (await File.ReadAllTextAsync(Path.Combine(extension, "version.txt")) != "new-extension") return 1;
            if (await File.ReadAllTextAsync(Path.Combine(helper, "version.txt")) != "new-helper") return 1;
            Console.WriteLine("UPDATER_SELF_TEST_OK");
            Console.WriteLine("ATOMIC_SWAP_OK");
            Console.WriteLine("ROLLBACK_RESTORE_OK");
            return 0;
        }
        finally { TryDeleteDirectory(root); }
    }
}

internal sealed class UpdatePlan
{
    public string InstallRoot { get; set; } = string.Empty;
    public string PackageRoot { get; set; } = string.Empty;
    public string UpdateRoot { get; set; } = string.Empty;
    public string TargetVersion { get; set; } = string.Empty;
    public int ParentProcessId { get; set; }
}
