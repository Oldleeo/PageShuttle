using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using PageShuttle.Shared;

namespace ChromeOnlyProxy.Host;

internal sealed class XrayManager : IDisposable
{
    private readonly object _sync = new();
    private Process? _process;
    private WindowsJob? _job;
    private string _recentErrors = string.Empty;

    public bool IsRunning
    {
        get
        {
            lock (_sync) return _process is { HasExited: false };
        }
    }

    public int? Port { get; private set; }

    public async Task<StartResult> StartAsync(JsonElement node)
    {
        Stop();
        var xrayPath = ResolveXrayPath();
        var port = FindFreePort();
        var config = XrayConfigBuilder.Build(node, port);
        var runtimeDirectory = Path.Combine(PlatformPaths.InstallRoot, "runtime");
        Directory.CreateDirectory(runtimeDirectory);
        var configPath = Path.Combine(runtimeDirectory, "xray-config.json");
        await File.WriteAllTextAsync(configPath, config, new UTF8Encoding(false));

        var validation = await RunAndCaptureAsync(xrayPath, $"run -test -config \"{configPath}\"", 10000);
        if (validation.ExitCode != 0)
            throw new InvalidOperationException($"Xray 配置校验失败：{CleanOutput(validation.Output)}");

        var startInfo = CreateStartInfo(xrayPath, $"run -config \"{configPath}\"");
        var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        var errorBuffer = new StringBuilder();
        void CaptureOutput(string? line)
        {
            if (string.IsNullOrWhiteSpace(line)) return;
            lock (_sync)
            {
                errorBuffer.AppendLine(line);
                if (errorBuffer.Length > 8000) errorBuffer.Remove(0, errorBuffer.Length - 8000);
                _recentErrors = errorBuffer.ToString();
            }
        }
        process.ErrorDataReceived += (_, eventArgs) => CaptureOutput(eventArgs.Data);
        process.OutputDataReceived += (_, eventArgs) => CaptureOutput(eventArgs.Data);

        if (!process.Start()) throw new InvalidOperationException("无法启动 Xray");
        process.BeginErrorReadLine();
        process.BeginOutputReadLine();
        WindowsJob? job = null;
        try
        {
            if (OperatingSystem.IsWindows())
            {
                job = new WindowsJob();
                job.AddProcess(process);
            }
        }
        catch
        {
            job?.Dispose();
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch { }
            process.Dispose();
            throw;
        }
        lock (_sync)
        {
            _process = process;
            _job = job;
            Port = port;
            _recentErrors = string.Empty;
        }

        try
        {
            await WaitForPortAsync(process, port, TimeSpan.FromSeconds(8));
            var version = await GetVersionAsync(xrayPath);
            return new StartResult(port, version);
        }
        catch
        {
            Stop();
            throw;
        }
    }

    public void Stop()
    {
        Process? process;
        WindowsJob? job;
        lock (_sync)
        {
            process = _process;
            job = _job;
            _process = null;
            _job = null;
            Port = null;
        }

        try { job?.Dispose(); } catch { }
        if (process is not null)
        {
            try
            {
                if (!process.HasExited) process.Kill(entireProcessTree: true);
                process.WaitForExit(2000);
            }
            catch { }
            process.Dispose();
        }
    }

    public void Dispose() => Stop();

    internal static string ResolveXrayPath()
    {
        var executable = PlatformPaths.ExecutableName("xray");
        var bundled = Path.Combine(AppContext.BaseDirectory, "xray", executable);
        if (File.Exists(bundled)) return bundled;
        throw new FileNotFoundException($"未找到 xray/{executable}，请重新安装页梭");
    }

    internal static async Task<ProcessResult> RunAndCaptureAsync(string executable, string arguments, int timeoutMs)
    {
        using var process = new Process { StartInfo = CreateStartInfo(executable, arguments) };
        process.Start();
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        using var cancellation = new CancellationTokenSource(timeoutMs);
        try { await process.WaitForExitAsync(cancellation.Token); }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch { }
            throw new TimeoutException("Xray 操作超时");
        }
        return new ProcessResult(process.ExitCode, (await stdout) + Environment.NewLine + (await stderr));
    }

    private static ProcessStartInfo CreateStartInfo(string executable, string arguments) => new()
    {
        FileName = executable,
        Arguments = arguments,
        UseShellExecute = false,
        CreateNoWindow = true,
        WindowStyle = ProcessWindowStyle.Hidden,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        WorkingDirectory = Path.GetDirectoryName(executable) ?? AppContext.BaseDirectory
    };

    private async Task WaitForPortAsync(Process process, int port, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (process.HasExited)
            {
                string errors;
                lock (_sync) errors = _recentErrors;
                throw new InvalidOperationException($"Xray 启动失败：{CleanOutput(errors)}");
            }
            try
            {
                using var client = new TcpClient(AddressFamily.InterNetwork);
                using var cancellation = new CancellationTokenSource(350);
                await client.ConnectAsync(IPAddress.Loopback, port, cancellation.Token);
                return;
            }
            catch { await Task.Delay(120); }
        }
        throw new TimeoutException("Xray 已启动，但本地回环端口未就绪");
    }

    private static int FindFreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private static async Task<string> GetVersionAsync(string xrayPath)
    {
        try
        {
            var result = await RunAndCaptureAsync(xrayPath, "version", 5000);
            return result.Output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "Xray";
        }
        catch { return "Xray"; }
    }

    private static string CleanOutput(string value)
    {
        var cleaned = string.Join(" ", value.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)).Trim();
        return string.IsNullOrWhiteSpace(cleaned) ? "未提供错误详情" : cleaned;
    }
}

internal sealed record StartResult(int Port, string CoreVersion);
internal sealed record ProcessResult(int ExitCode, string Output);
