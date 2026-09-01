using System.Text.Json;
using System.Text.Json.Nodes;

namespace ChromeOnlyProxy.Host;

internal static class XrayConfigBuilder
{
    public static string Build(JsonElement node, int localPort)
    {
        var type = Required(node, "type").ToLowerInvariant();
        JsonObject outbound = type switch
        {
            "vless" => BuildVless(node),
            "vmess" => BuildVmess(node),
            "trojan" => BuildTrojan(node),
            "ss" => BuildShadowsocks(node),
            _ => throw new InvalidOperationException($"本地助手不支持 {type} 协议")
        };

        var root = new JsonObject
        {
            ["log"] = new JsonObject { ["loglevel"] = "warning" },
            ["inbounds"] = new JsonArray
            {
                new JsonObject
                {
                    ["tag"] = "chrome-in",
                    ["listen"] = "127.0.0.1",
                    ["port"] = localPort,
                    ["protocol"] = "socks",
                    ["settings"] = new JsonObject
                    {
                        ["auth"] = "noauth",
                        ["udp"] = false,
                        ["ip"] = "127.0.0.1"
                    },
                    ["sniffing"] = new JsonObject
                    {
                        ["enabled"] = true,
                        ["destOverride"] = new JsonArray("http", "tls")
                    }
                }
            },
            ["outbounds"] = new JsonArray(outbound)
        };
        return root.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
    }

    private static JsonObject BuildVless(JsonElement node)
    {
        var user = new JsonObject
        {
            ["id"] = Required(node, "uuid"),
            ["encryption"] = Value(node, "encryption", "none")
        };
        AddIf(user, "flow", Value(node, "flow"));
        return WithStream(node, "vless", new JsonObject
        {
            ["vnext"] = new JsonArray
            {
                new JsonObject
                {
                    ["address"] = Required(node, "server"),
                    ["port"] = Port(node),
                    ["users"] = new JsonArray(user)
                }
            }
        });
    }

    private static JsonObject BuildVmess(JsonElement node)
    {
        var user = new JsonObject
        {
            ["id"] = Required(node, "uuid"),
            ["alterId"] = Integer(node, "alterId", 0),
            ["security"] = Value(node, "cipher", "auto")
        };
        return WithStream(node, "vmess", new JsonObject
        {
            ["vnext"] = new JsonArray
            {
                new JsonObject
                {
                    ["address"] = Required(node, "server"),
                    ["port"] = Port(node),
                    ["users"] = new JsonArray(user)
                }
            }
        });
    }

    private static JsonObject BuildTrojan(JsonElement node)
    {
        return WithStream(node, "trojan", new JsonObject
        {
            ["servers"] = new JsonArray
            {
                new JsonObject
                {
                    ["address"] = Required(node, "server"),
                    ["port"] = Port(node),
                    ["password"] = Required(node, "password")
                }
            }
        });
    }

    private static JsonObject BuildShadowsocks(JsonElement node)
    {
        return new JsonObject
        {
            ["tag"] = "proxy-out",
            ["protocol"] = "shadowsocks",
            ["settings"] = new JsonObject
            {
                ["servers"] = new JsonArray
                {
                    new JsonObject
                    {
                        ["address"] = Required(node, "server"),
                        ["port"] = Port(node),
                        ["method"] = Required(node, "cipher"),
                        ["password"] = Required(node, "password")
                    }
                }
            }
        };
    }

    private static JsonObject WithStream(JsonElement node, string protocol, JsonObject settings)
    {
        return new JsonObject
        {
            ["tag"] = "proxy-out",
            ["protocol"] = protocol,
            ["settings"] = settings,
            ["streamSettings"] = BuildStreamSettings(node)
        };
    }

    private static JsonObject BuildStreamSettings(JsonElement node)
    {
        var network = Value(node, "network", "tcp").ToLowerInvariant();
        var security = Value(node, "security", "none").ToLowerInvariant();
        var stream = new JsonObject
        {
            ["network"] = network,
            ["security"] = security
        };

        if (security == "tls")
        {
            var tls = new JsonObject { ["allowInsecure"] = Boolean(node, "allowInsecure") };
            AddIf(tls, "serverName", Value(node, "sni"));
            AddIf(tls, "fingerprint", Value(node, "fingerprint", "chrome"));
            var alpn = StringArray(node, "alpn");
            if (alpn.Count > 0) tls["alpn"] = alpn;
            stream["tlsSettings"] = tls;
        }
        else if (security == "reality")
        {
            var reality = new JsonObject
            {
                ["serverName"] = Required(node, "sni"),
                ["fingerprint"] = Value(node, "fingerprint", "chrome"),
                ["publicKey"] = Required(node, "publicKey"),
                ["shortId"] = Value(node, "shortId")
            };
            AddIf(reality, "spiderX", Value(node, "spiderX"));
            stream["realitySettings"] = reality;
        }

        switch (network)
        {
            case "ws":
                var ws = new JsonObject { ["path"] = Value(node, "path", "/") };
                var host = Value(node, "host");
                if (!string.IsNullOrWhiteSpace(host)) ws["headers"] = new JsonObject { ["Host"] = host };
                stream["wsSettings"] = ws;
                break;
            case "grpc":
                var grpc = new JsonObject { ["serviceName"] = Value(node, "serviceName") };
                var mode = Value(node, "mode");
                if (mode.Equals("multi", StringComparison.OrdinalIgnoreCase)) grpc["multiMode"] = true;
                stream["grpcSettings"] = grpc;
                break;
            case "xhttp":
                var xhttp = new JsonObject { ["path"] = Value(node, "path", "/") };
                AddIf(xhttp, "host", Value(node, "host"));
                AddIf(xhttp, "mode", Value(node, "mode"));
                stream["xhttpSettings"] = xhttp;
                break;
            case "httpupgrade":
                var upgrade = new JsonObject { ["path"] = Value(node, "path", "/") };
                AddIf(upgrade, "host", Value(node, "host"));
                stream["httpupgradeSettings"] = upgrade;
                break;
            case "tcp":
                stream["tcpSettings"] = new JsonObject
                {
                    ["header"] = new JsonObject { ["type"] = Value(node, "headerType", "none") }
                };
                break;
        }
        return stream;
    }

    private static string Required(JsonElement node, string name)
    {
        var value = Value(node, name);
        if (string.IsNullOrWhiteSpace(value)) throw new InvalidOperationException($"节点缺少 {name}");
        return value;
    }

    private static string Value(JsonElement node, string name, string fallback = "")
    {
        if (!node.TryGetProperty(name, out var value) || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return fallback;
        return value.ValueKind == JsonValueKind.String ? value.GetString() ?? fallback : value.ToString();
    }

    private static int Port(JsonElement node)
    {
        var value = Integer(node, "port", 0);
        if (value is < 1 or > 65535) throw new InvalidOperationException("节点端口无效");
        return value;
    }

    private static int Integer(JsonElement node, string name, int fallback)
    {
        if (!node.TryGetProperty(name, out var value)) return fallback;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)) return number;
        return int.TryParse(value.ToString(), out number) ? number : fallback;
    }

    private static bool Boolean(JsonElement node, string name)
    {
        if (!node.TryGetProperty(name, out var value)) return false;
        if (value.ValueKind is JsonValueKind.True or JsonValueKind.False) return value.GetBoolean();
        return bool.TryParse(value.ToString(), out var result) && result;
    }

    private static JsonArray StringArray(JsonElement node, string name)
    {
        var result = new JsonArray();
        if (!node.TryGetProperty(name, out var value)) return result;
        if (value.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in value.EnumerateArray())
                if (item.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(item.GetString())) result.Add(item.GetString());
        }
        return result;
    }

    private static void AddIf(JsonObject target, string name, string value)
    {
        if (!string.IsNullOrWhiteSpace(value)) target[name] = value;
    }
}
