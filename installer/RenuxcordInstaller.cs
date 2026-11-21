/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Windows installer for Renuxcord. C# 5 / .NET Framework 4.x so it builds with the csc.exe that ships with Windows.
// Build: installer/build.ps1

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Renuxcord Installer")]
[assembly: System.Reflection.AssemblyProduct("Renuxcord")]
[assembly: System.Reflection.AssemblyDescription("Installs Renuxcord, a Vencord-based Discord client mod")]
[assembly: System.Reflection.AssemblyCopyright("GPL-3.0-or-later")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

namespace Renuxcord.Installer
{
    static class Config
    {
        // build.ps1 swaps this for owner/repo
        public const string Repo = "RENUXCORD_REPO_PLACEHOLDER";
    }

    class Flavor
    {
        public readonly string Name;
        public readonly string Folder;
        public readonly string Exe;

        public Flavor(string name, string folder, string exe)
        {
            Name = name;
            Folder = folder;
            Exe = exe;
        }

        public string BaseDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Folder); }
        }

        public override string ToString()
        {
            return Name;
        }
    }

    static class Core
    {
        public static readonly Flavor[] Flavors =
        {
            new Flavor("Discord", "Discord", "Discord.exe"),
            new Flavor("Discord PTB", "DiscordPTB", "DiscordPTB.exe"),
            new Flavor("Discord Canary", "DiscordCanary", "DiscordCanary.exe"),
            new Flavor("Discord Development", "DiscordDevelopment", "DiscordDevelopment.exe")
        };

        static readonly string[] Required = { "patcher.js", "preload.js", "renderer.js", "renderer.css" };
        static readonly string[] Optional = { "renuxcord-mcp.mjs", "patcher.js.map", "preload.js.map", "renderer.js.map", "renderer.css.map" };

        public static string LocalOverride;

        public static string DataDir
        {
            get
            {
                string env = Environment.GetEnvironmentVariable("RENUXCORD_USER_DATA_DIR");
                return string.IsNullOrEmpty(env)
                    ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Renuxcord")
                    : env;
            }
        }

        public static string DistDir
        {
            get { return Path.Combine(DataDir, "dist"); }
        }

        static int CompareVersions(string a, string b)
        {
            int[] pa = Path.GetFileName(a).Substring(4).Split('.').Select(ToInt).ToArray();
            int[] pb = Path.GetFileName(b).Substring(4).Split('.').Select(ToInt).ToArray();
            for (int i = 0; i < Math.Max(pa.Length, pb.Length); i++)
            {
                int d = (i < pa.Length ? pa[i] : 0) - (i < pb.Length ? pb[i] : 0);
                if (d != 0) return d;
            }
            return 0;
        }

        static int ToInt(string s)
        {
            int n;
            int.TryParse(s, out n);
            return n;
        }

        public static List<string> ResourceDirs(Flavor f)
        {
            var list = new List<string>();
            if (!Directory.Exists(f.BaseDir)) return list;

            var apps = Directory.GetDirectories(f.BaseDir, "app-*").ToList();
            apps.Sort(CompareVersions);
            foreach (string app in apps)
            {
                string res = Path.Combine(app, "resources");
                if (Directory.Exists(res)) list.Add(res);
            }
            return list;
        }

        public static bool IsInstalled(Flavor f)
        {
            return ResourceDirs(f).Count > 0;
        }

        public static string Describe(string resources)
        {
            string app = Path.Combine(resources, "app.asar");
            string backup = Path.Combine(resources, "_app.asar");
            if (!File.Exists(app)) return "Broken install (app.asar missing)";
            if (!File.Exists(backup)) return "Vanilla Discord";
            if (new FileInfo(app).Length > 4096) return "Another mod is installed";

            Match m = Regex.Match(Encoding.UTF8.GetString(File.ReadAllBytes(app)), "require\\(\"(.+?)\"\\)");
            string target = m.Success ? m.Groups[1].Value : "";
            if (target.IndexOf("renuxcord", StringComparison.OrdinalIgnoreCase) >= 0) return "Renuxcord is installed";
            if (target.IndexOf("vencord", StringComparison.OrdinalIgnoreCase) >= 0) return "Another client mod is installed";
            return "Another mod is installed";
        }

        public static string Status(Flavor f)
        {
            List<string> dirs = ResourceDirs(f);
            return dirs.Count == 0 ? "Not installed" : Describe(dirs[dirs.Count - 1]);
        }

        static string JsString(string s)
        {
            return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
        }

        static void WriteU32(byte[] buf, int offset, int value)
        {
            buf[offset] = (byte)value;
            buf[offset + 1] = (byte)(value >> 8);
            buf[offset + 2] = (byte)(value >> 16);
            buf[offset + 3] = (byte)(value >> 24);
        }

        // Same tiny asar the Vencord installer writes: index.js requires our patcher.js
        public static byte[] MakeStub(string patcherPath)
        {
            byte[] index = Encoding.UTF8.GetBytes("require(" + JsString(patcherPath) + ")");
            byte[] pkg = Encoding.UTF8.GetBytes("{\n\t\"name\": \"discord\",\n\t\"main\": \"index.js\"\n}");
            byte[] header = Encoding.UTF8.GetBytes(
                "{\"files\":{\"index.js\":{\"size\":" + index.Length + ",\"offset\":\"0\"},\"package.json\":{\"size\":"
                + pkg.Length + ",\"offset\":\"" + index.Length + "\"}}}");
            int padded = (header.Length + 3) / 4 * 4;

            byte[] output = new byte[16 + padded + index.Length + pkg.Length];
            WriteU32(output, 0, 4);
            WriteU32(output, 4, 8 + padded);
            WriteU32(output, 8, 4 + padded);
            WriteU32(output, 12, header.Length);
            header.CopyTo(output, 16);
            index.CopyTo(output, 16 + padded);
            pkg.CopyTo(output, 16 + padded + index.Length);
            return output;
        }

        public static string LocalDist()
        {
            if (LocalOverride != null) return LocalOverride;
            string nextToExe = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "dist");
            return File.Exists(Path.Combine(nextToExe, "patcher.js")) ? nextToExe : null;
        }

        static WebClient Client()
        {
            var wc = new WebClient();
            wc.Headers.Add("User-Agent", "RenuxcordInstaller");
            return wc;
        }

        public static void Fetch(Action<string> log)
        {
            Directory.CreateDirectory(DistDir);
            string local = LocalDist();

            if (local != null)
            {
                log("Using the local build in " + local);
                foreach (string f in Required.Concat(Optional))
                {
                    string src = Path.Combine(local, f);
                    if (File.Exists(src)) File.Copy(src, Path.Combine(DistDir, f), true);
                }
            }
            else
            {
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                log("Looking up the latest release on github.com/" + Config.Repo + "...");

                string json = Client().DownloadString("https://api.github.com/repos/" + Config.Repo + "/releases/latest");
                var release = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
                log("Latest: " + release["name"]);

                foreach (Dictionary<string, object> asset in (ArrayList)release["assets"])
                {
                    string name = (string)asset["name"];
                    if (!Required.Contains(name) && !Optional.Contains(name)) continue;
                    log("Downloading " + name);
                    Client().DownloadFile((string)asset["browser_download_url"], Path.Combine(DistDir, name));
                }
            }

            foreach (string f in Required)
                if (!File.Exists(Path.Combine(DistDir, f))) throw new Exception(f + " is missing from the download");

            File.WriteAllText(Path.Combine(DistDir, "package.json"), "{}");
        }

        static void Kill(Flavor f, Action<string> log)
        {
            Process[] procs = Process.GetProcessesByName(Path.GetFileNameWithoutExtension(f.Exe));
            if (procs.Length == 0) return;

            log("Closing " + f.Name + "...");
            foreach (Process p in procs)
            {
                try { p.Kill(); } catch { }
            }
            foreach (Process p in procs)
            {
                try { p.WaitForExit(5000); } catch { }
            }
            Thread.Sleep(1500);
        }

        static void Start(Flavor f, Action<string> log)
        {
            string updater = Path.Combine(f.BaseDir, "Update.exe");
            if (!File.Exists(updater)) return;
            log("Starting " + f.Name + "...");
            var psi = new ProcessStartInfo(updater, "--processStart " + f.Exe);
            psi.UseShellExecute = false;
            Process.Start(psi);
        }

        public static void Install(Flavor f, Action<string> log)
        {
            Kill(f, log);
            byte[] stub = MakeStub(Path.Combine(DistDir, "patcher.js"));

            foreach (string res in ResourceDirs(f))
            {
                string app = Path.Combine(res, "app.asar");
                string backup = Path.Combine(res, "_app.asar");
                if (!File.Exists(backup))
                {
                    if (!File.Exists(app))
                    {
                        log("Skipping " + res + " (no app.asar)");
                        continue;
                    }
                    File.Move(app, backup);
                }
                File.WriteAllBytes(app, stub);
                log("Patched " + res);
            }
            Start(f, log);
        }

        public static void Uninstall(Flavor f, Action<string> log)
        {
            Kill(f, log);
            foreach (string res in ResourceDirs(f))
            {
                string app = Path.Combine(res, "app.asar");
                string backup = Path.Combine(res, "_app.asar");
                if (!File.Exists(backup)) continue;
                if (File.Exists(app)) File.Delete(app);
                File.Move(backup, app);
                log("Restored " + res);
            }
            Start(f, log);
        }
    }

    class MainForm : Form
    {
        static readonly Color Bg = Color.FromArgb(12, 12, 13);
        static readonly Color Surface = Color.FromArgb(23, 23, 26);
        static readonly Color Accent = Color.FromArgb(255, 90, 44);
        static readonly Color Ink = Color.FromArgb(12, 12, 13);
        static readonly Color Text1 = Color.FromArgb(242, 240, 235);
        static readonly Color Muted = Color.FromArgb(154, 151, 143);

        readonly ComboBox flavorBox;
        readonly Label statusLabel;
        readonly Button installButton;
        readonly Button uninstallButton;
        readonly TextBox logBox;
        readonly ProgressBar bar;

        public MainForm()
        {
            Text = "Renuxcord Installer";
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96F, 96F);
            ClientSize = new Size(640, 520);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            BackColor = Bg;
            ForeColor = Text1;
            Font = new Font("Segoe UI", 10f);
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

            var header = new Panel { Location = new Point(0, 0), Size = new Size(640, 112) };
            header.Paint += PaintHeader;

            var flavorLabel = new Label { Text = "DISCORD INSTALL", ForeColor = Muted, AutoSize = true, Location = new Point(28, 132), Font = new Font("Segoe UI Semibold", 8.5f) };
            flavorBox = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Location = new Point(28, 154), Width = 250, BackColor = Surface, ForeColor = Text1, FlatStyle = FlatStyle.Flat };
            statusLabel = new Label { AutoSize = true, Location = new Point(292, 158), ForeColor = Muted };

            installButton = MakeButton("Install / Repair", Accent, new Point(28, 202), 190);
            installButton.ForeColor = Ink;
            uninstallButton = MakeButton("Uninstall", Surface, new Point(228, 202), 150);
            Button folderButton = MakeButton("Open Renuxcord folder", Surface, new Point(388, 202), 224);

            bar = new ProgressBar { Style = ProgressBarStyle.Marquee, Location = new Point(28, 254), Size = new Size(584, 4), Visible = false };
            logBox = new TextBox
            {
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                Location = new Point(28, 266),
                Size = new Size(584, 206),
                BackColor = Surface,
                ForeColor = Text1,
                BorderStyle = BorderStyle.None,
                Font = new Font("Consolas", 9.5f)
            };
            var footer = new Label
            {
                Text = "Free and open source (GPL-3.0). github.com/" + Config.Repo,
                ForeColor = Muted,
                AutoSize = true,
                Location = new Point(28, 486),
                Font = new Font("Segoe UI", 8.5f)
            };

            Controls.AddRange(new Control[] { header, flavorLabel, flavorBox, statusLabel, installButton, uninstallButton, folderButton, bar, logBox, footer });

            foreach (Flavor f in Core.Flavors)
                if (Core.IsInstalled(f)) flavorBox.Items.Add(f);

            flavorBox.SelectedIndexChanged += delegate { RefreshStatus(); };
            installButton.Click += delegate { Run(true); };
            uninstallButton.Click += delegate { Run(false); };
            folderButton.Click += delegate
            {
                Directory.CreateDirectory(Core.DataDir);
                Process.Start("explorer.exe", Core.DataDir);
            };

            if (flavorBox.Items.Count > 0)
            {
                flavorBox.SelectedIndex = 0;
            }
            else
            {
                statusLabel.Text = "Discord isn't installed";
                installButton.Enabled = uninstallButton.Enabled = false;
            }

            string local = Core.LocalDist();
            Log(local != null ? "Ready to install the local build from " + local : "Ready to install the latest Renuxcord from github.com/" + Config.Repo);
        }

        void PaintHeader(object sender, PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

            using (var brush = new SolidBrush(Bg))
                g.FillRectangle(brush, 0, 0, 640, 112);
            using (var line = new Pen(Color.FromArgb(44, 44, 49)))
                g.DrawLine(line, 28, 111, 612, 111);

            var logo = new Rectangle(28, 26, 60, 60);
            using (var path = RoundedRect(logo, 16))
            using (var brush = new SolidBrush(Accent))
                g.FillPath(brush, path);
            using (var f = new Font("Segoe UI Black", 26f, FontStyle.Bold))
            using (var fmt = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
            using (var ink = new SolidBrush(Ink))
                g.DrawString("R", f, ink, logo, fmt);

            using (var f = new Font("Segoe UI Semibold", 24f))
                g.DrawString("Renuxcord", f, new SolidBrush(Text1), 100, 22);
            using (var f = new Font("Segoe UI", 10f))
                g.DrawString("217 plugins, Renuxcord exclusives, the AI bridge and auto-updates", f, new SolidBrush(Muted), 104, 66);
        }

        static GraphicsPath RoundedRect(Rectangle r, int radius)
        {
            var path = new GraphicsPath();
            int d = radius * 2;
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        static Button MakeButton(string text, Color bg, Point location, int width)
        {
            var b = new Button
            {
                Text = text,
                Location = location,
                Size = new Size(width, 40),
                FlatStyle = FlatStyle.Flat,
                BackColor = bg,
                ForeColor = Color.White,
                Cursor = Cursors.Hand,
                Font = new Font("Segoe UI Semibold", 10f)
            };
            b.FlatAppearance.BorderSize = 0;
            return b;
        }

        void RefreshStatus()
        {
            var f = flavorBox.SelectedItem as Flavor;
            statusLabel.Text = f == null ? "" : Core.Status(f);
        }

        void Log(string line)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action<string>(Log), line);
                return;
            }
            logBox.AppendText(line + Environment.NewLine);
        }

        void SetBusy(bool busy)
        {
            installButton.Enabled = uninstallButton.Enabled = flavorBox.Enabled = !busy;
            bar.Visible = busy;
        }

        void Run(bool install)
        {
            var flavor = flavorBox.SelectedItem as Flavor;
            if (flavor == null) return;
            SetBusy(true);

            var worker = new Thread(delegate ()
            {
                try
                {
                    if (install)
                    {
                        Core.Fetch(Log);
                        Core.Install(flavor, Log);
                        Log("Done! " + flavor.Name + " is starting with Renuxcord. It updates itself from now on.");
                    }
                    else
                    {
                        Core.Uninstall(flavor, Log);
                        Log("Done. " + flavor.Name + " is back to normal. Your Renuxcord settings were kept.");
                    }
                }
                catch (Exception ex)
                {
                    Log("Error: " + ex.Message);
                }
                finally
                {
                    BeginInvoke(new Action(delegate
                    {
                        SetBusy(false);
                        RefreshStatus();
                    }));
                }
            });
            worker.IsBackground = true;
            worker.Start();
        }
    }

    static class Program
    {
        [DllImport("kernel32.dll")]
        static extern bool AttachConsole(int processId);

        [DllImport("user32.dll")]
        static extern bool SetProcessDPIAware();

        [STAThread]
        static int Main(string[] args)
        {
            for (int i = 0; i < args.Length - 1; i++)
                if (args[i] == "--local") Core.LocalOverride = Path.GetFullPath(args[i + 1]);

            if (args.Contains("--install") || args.Contains("--uninstall") || args.Contains("--status"))
                return RunCli(args);

            SetProcessDPIAware();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
            return 0;
        }

        static int RunCli(string[] args)
        {
            AttachConsole(-1);
            Action<string> log = Console.WriteLine;
            Console.WriteLine();

            try
            {
                var flavors = Core.Flavors.Where(Core.IsInstalled).ToList();
                if (flavors.Count == 0) throw new Exception("No Discord install found");

                if (args.Contains("--status"))
                {
                    foreach (Flavor f in flavors) log(f.Name + ": " + Core.Status(f));
                }
                else if (args.Contains("--install"))
                {
                    Core.Fetch(log);
                    foreach (Flavor f in flavors) Core.Install(f, log);
                    log("Renuxcord installed.");
                }
                else
                {
                    foreach (Flavor f in flavors) Core.Uninstall(f, log);
                    log("Renuxcord removed.");
                }
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Error: " + ex.Message);
                return 1;
            }
        }
    }
}
