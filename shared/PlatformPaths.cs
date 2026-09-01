using System.Runtime.InteropServices;

namespace PageShuttle.Shared;

internal static class PlatformPaths
{
    public static string InstallRoot
    {
        get
        {
            if (OperatingSystem.IsWindows())
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Oldlee", "ChromeOnlyProxy");
            }

            if (OperatingSystem.IsMacOS())
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    "Library", "Application Support", "Oldlee", "ChromeOnlyProxy");
            }

            throw new PlatformNotSupportedException("页梭目前仅支持 Windows 和 macOS");
        }
    }

    public static string RuntimeIdentifier
    {
        get
        {
            var architecture = RuntimeInformation.ProcessArchitecture;
            if (OperatingSystem.IsWindows() && architecture == Architecture.X64) return "win-x64";
            if (OperatingSystem.IsMacOS() && architecture == Architecture.X64) return "osx-x64";
            if (OperatingSystem.IsMacOS() && architecture == Architecture.Arm64) return "osx-arm64";
            throw new PlatformNotSupportedException($"不支持当前系统架构：{RuntimeInformation.OSDescription} {architecture}");
        }
    }

    public static string ExecutableName(string baseName) => OperatingSystem.IsWindows() ? $"{baseName}.exe" : baseName;

    public static StringComparison PathComparison => OperatingSystem.IsWindows()
        ? StringComparison.OrdinalIgnoreCase
        : StringComparison.Ordinal;

    public static void EnsureExecutable(string path)
    {
        if (OperatingSystem.IsWindows() || !File.Exists(path)) return;
        File.SetUnixFileMode(path,
            UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute |
            UnixFileMode.GroupRead | UnixFileMode.GroupExecute |
            UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
    }
}
