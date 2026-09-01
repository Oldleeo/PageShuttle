using System.Text.Json;

namespace ChromeOnlyProxy.Host;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static async Task<int> Main(string[] args)
    {
        if (args.Contains("--self-test", StringComparer.OrdinalIgnoreCase))
            return await SelfTest.RunAsync();

        using var manager = new XrayManager();
        var updater = new UpdateManager();
        using var input = Console.OpenStandardInput();
        using var output = Console.OpenStandardOutput();

        while (true)
        {
            JsonDocument? request = null;
            try
            {
                request = await NativeMessaging.ReadAsync(input);
                if (request is null) break;
                var root = request.RootElement;
                var id = root.TryGetProperty("id", out var idElement) ? idElement.GetString() ?? string.Empty : string.Empty;
                var action = root.TryGetProperty("action", out var actionElement) ? actionElement.GetString() ?? string.Empty : string.Empty;

                var exitAfterResponse = false;
                object response = action switch
                {
                    "ping" => new { id, ok = true, version = UpdateManager.CurrentVersion, platform = PageShuttle.Shared.PlatformPaths.RuntimeIdentifier },
                    "status" => new { id, ok = true, running = manager.IsRunning, port = manager.Port, version = UpdateManager.CurrentVersion, platform = PageShuttle.Shared.PlatformPaths.RuntimeIdentifier, updateResult = updater.ReadLastResult() },
                    "start" => await StartAsync(manager, id, root),
                    "stop" => Stop(manager, id),
                    "check_update" => await CheckUpdateAsync(updater, id),
                    "install_update" => await InstallUpdateAsync(updater, manager, id, () => exitAfterResponse = true),
                    _ => new { id, ok = false, error = "未知操作" }
                };
                await NativeMessaging.WriteAsync(output, response, JsonOptions);
                if (exitAfterResponse) break;
            }
            catch (Exception ex)
            {
                var id = request?.RootElement.TryGetProperty("id", out var idElement) == true
                    ? idElement.GetString() ?? string.Empty
                    : string.Empty;
                await NativeMessaging.WriteAsync(output, new { id, ok = false, error = FriendlyError(ex) }, JsonOptions);
            }
            finally
            {
                request?.Dispose();
            }
        }

        return 0;
    }

    private static async Task<object> StartAsync(XrayManager manager, string id, JsonElement root)
    {
        if (!root.TryGetProperty("node", out var node)) throw new InvalidOperationException("缺少节点配置");
        var result = await manager.StartAsync(node);
        return new { id, ok = true, port = result.Port, protocol = "socks5", coreVersion = result.CoreVersion };
    }

    private static object Stop(XrayManager manager, string id)
    {
        manager.Stop();
        return new { id, ok = true, running = false };
    }

    private static async Task<object> CheckUpdateAsync(UpdateManager updater, string id)
    {
        var result = await updater.CheckAsync();
        return new
        {
            id,
            ok = true,
            available = result.Available,
            currentVersion = result.CurrentVersion,
            update = result.Manifest
        };
    }

    private static async Task<object> InstallUpdateAsync(UpdateManager updater, XrayManager manager, string id, Action requestExit)
    {
        var result = await updater.PrepareInstallAsync(manager);
        requestExit();
        return new { id, ok = true, installing = result.Installing, version = result.Version, releasePage = result.ReleasePage };
    }

    private static string FriendlyError(Exception exception)
    {
        var message = exception.Message.Trim();
        return message.Length > 600 ? message[..600] : message;
    }
}
