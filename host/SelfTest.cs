using System.Text.Json;

namespace ChromeOnlyProxy.Host;

internal static class SelfTest
{
    public static async Task<int> RunAsync()
    {
        try
        {
            var samples = new[]
            {
                """{"type":"vless","server":"example.com","port":443,"uuid":"11111111-1111-1111-1111-111111111111","network":"ws","security":"tls","sni":"example.com","host":"example.com","path":"/ws","fingerprint":"chrome"}""",
                """{"type":"vless","server":"example.com","port":443,"uuid":"11111111-1111-1111-1111-111111111111","network":"tcp","security":"reality","sni":"www.microsoft.com","publicKey":"RvxjxzYTqJSRmWKkaeifJunkRbXgKDLqFFMa5PV_V2M","shortId":"0123456789abcdef","fingerprint":"chrome"}""",
                """{"type":"vmess","server":"example.com","port":443,"uuid":"11111111-1111-1111-1111-111111111111","alterId":0,"cipher":"auto","network":"grpc","security":"tls","sni":"example.com","serviceName":"grpc"}""",
                """{"type":"trojan","server":"example.com","port":443,"password":"test-password","network":"tcp","security":"tls","sni":"example.com"}""",
                """{"type":"ss","server":"example.com","port":8388,"cipher":"aes-128-gcm","password":"test-password"}"""
            };

            var xray = XrayManager.ResolveXrayPath();
            var tempDirectory = Path.Combine(Path.GetTempPath(), "ChromeOnlyProxy-SelfTest-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempDirectory);
            try
            {
                for (var index = 0; index < samples.Length; index++)
                {
                    using var document = JsonDocument.Parse(samples[index]);
                    var config = XrayConfigBuilder.Build(document.RootElement, 39000 + index);
                    if (!config.Contains("\"listen\": \"127.0.0.1\"", StringComparison.Ordinal))
                        throw new InvalidOperationException("回环监听安全检查失败");
                    if (config.Contains("0.0.0.0", StringComparison.Ordinal) || config.Contains("\"protocol\": \"tun\"", StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("配置中出现非回环监听或 TUN");
                    var path = Path.Combine(tempDirectory, $"sample-{index}.json");
                    await File.WriteAllTextAsync(path, config);
                    var validation = await XrayManager.RunAndCaptureAsync(xray, $"run -test -config \"{path}\"", 10000);
                    if (validation.ExitCode != 0)
                        throw new InvalidOperationException($"样例 {index + 1} 未通过 Xray 配置校验：{validation.Output}");
                }
            }
            finally
            {
                try { Directory.Delete(tempDirectory, recursive: true); } catch { }
            }

            Console.WriteLine("SELF_TEST_OK");
            Console.WriteLine($"XRAY={Path.GetFileName(xray)}");
            Console.WriteLine($"CONFIGS={samples.Length}");
            Console.WriteLine("LISTEN=127.0.0.1_ONLY");
            Console.WriteLine("SYSTEM_PROXY_API=NOT_USED");
            if (!UpdateManager.IsNewer("0.6.1", "0.6.0") || UpdateManager.IsNewer("0.6.0", "0.6.0"))
                throw new InvalidOperationException("版本比较自测失败");
            Console.WriteLine("UPDATE_VERSION_CHECK_OK");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("SELF_TEST_FAILED");
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }
}
