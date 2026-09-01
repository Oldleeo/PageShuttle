using System.Buffers.Binary;
using System.Text.Json;

namespace ChromeOnlyProxy.Host;

internal static class NativeMessaging
{
    private const int MaximumMessageBytes = 1024 * 1024;

    public static async Task<JsonDocument?> ReadAsync(Stream input)
    {
        var header = new byte[4];
        var headerRead = await ReadExactAsync(input, header, allowEndOfStream: true);
        if (headerRead == 0) return null;
        if (headerRead != 4) throw new InvalidDataException("原生消息长度头不完整");

        var length = BinaryPrimitives.ReadInt32LittleEndian(header);
        if (length <= 0 || length > MaximumMessageBytes) throw new InvalidDataException("原生消息长度无效");
        var payload = new byte[length];
        if (await ReadExactAsync(input, payload, allowEndOfStream: false) != length)
            throw new EndOfStreamException("原生消息内容不完整");
        return JsonDocument.Parse(payload);
    }

    public static async Task WriteAsync(Stream output, object message, JsonSerializerOptions options)
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(message, options);
        var header = new byte[4];
        BinaryPrimitives.WriteInt32LittleEndian(header, payload.Length);
        await output.WriteAsync(header);
        await output.WriteAsync(payload);
        await output.FlushAsync();
    }

    private static async Task<int> ReadExactAsync(Stream input, byte[] buffer, bool allowEndOfStream)
    {
        var total = 0;
        while (total < buffer.Length)
        {
            var read = await input.ReadAsync(buffer.AsMemory(total, buffer.Length - total));
            if (read == 0)
            {
                if (allowEndOfStream) return total;
                break;
            }
            total += read;
        }
        return total;
    }
}
