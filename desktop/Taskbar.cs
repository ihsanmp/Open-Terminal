// Taskbar integration for the app windows (compiled by OpenTerminal.ps1):
// one AppUserModelID for every app window and the shortcuts, so they share a
// taskbar button whose right-click menu (jump list) has "New window", and so
// pinning a window pins the shortcut (which starts the servers too).
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace OpenTerminal
{
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    public struct PropertyKey
    {
        public Guid FormatId;
        public uint PropertyId;
        public PropertyKey(string formatId, uint propertyId) { FormatId = new Guid(formatId); PropertyId = propertyId; }
    }

    // PROPVARIANT: only strings (VT_LPWSTR) are used here. 24 bytes on x64.
    [StructLayout(LayoutKind.Explicit, Size = 24)]
    public struct PropVariant
    {
        [FieldOffset(0)] public ushort Type;
        [FieldOffset(8)] public IntPtr Value;
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }

    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int size, IntPtr findData, uint flags);
        void GetIDList(out IntPtr idList);
        void SetIDList(IntPtr idList);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int size);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder dir, int size);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder args, int size);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
        void GetHotkey(out short hotkey);
        void SetHotkey(short hotkey);
        void GetShowCmd(out int showCmd);
        void SetShowCmd(int showCmd);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr hwnd, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
    }

    [ComImport, Guid("92CA9DCD-5622-4BBA-A805-5E9F541BD8C9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IObjectArray
    {
        void GetCount(out uint count);
        void GetAt(uint index, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object item);
    }

    [ComImport, Guid("5632B1A4-E38A-400A-928A-D4CD63230295"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IObjectCollection
    {
        void GetCount(out uint count);
        void GetAt(uint index, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object item);
        void AddObject([MarshalAs(UnmanagedType.Interface)] object item);
        void AddFromArray(IObjectArray items);
        void RemoveObjectAt(uint index);
        void Clear();
    }

    [ComImport, Guid("6332DEBF-87B5-4670-90C0-5E57B408A49E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ICustomDestinationList
    {
        void SetAppID([MarshalAs(UnmanagedType.LPWStr)] string appId);
        void BeginList(out uint minSlots, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object removed);
        void AppendCategory([MarshalAs(UnmanagedType.LPWStr)] string category, IObjectArray items);
        void AppendKnownCategory(int category);
        void AddUserTasks(IObjectArray tasks);
        void CommitList();
        void GetRemovedDestinations(ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object removed);
        void DeleteList([MarshalAs(UnmanagedType.LPWStr)] string appId);
        void AbortList();
    }

    [ComImport, Guid("77f10cf0-3db5-4966-b520-b7c54fd35ed6")] class DestinationList { }
    [ComImport, Guid("2d3468c1-36a7-43b6-ac24-d3f02fd9607a")] class EnumerableObjectCollection { }
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class ShellLink { }

    public static class Taskbar
    {
        const string AppUserModel = "9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3";
        static PropertyKey AppId = new PropertyKey(AppUserModel, 5);
        static PropertyKey Title = new PropertyKey("F29F85E0-4FF9-1068-AB91-08002B27B3D9", 2);
        static Guid PropertyStoreId = typeof(IPropertyStore).GUID;
        const ushort VT_LPWSTR = 31;

        delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
        [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint command);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int size);
        [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
        [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);

        static string Get(IPropertyStore store, PropertyKey key)
        {
            PropVariant v;
            if (store.GetValue(ref key, out v) != 0) return null;
            string s = v.Type == VT_LPWSTR ? Marshal.PtrToStringUni(v.Value) : null;
            PropVariantClear(ref v);
            return s;
        }

        static void Set(IPropertyStore store, PropertyKey key, string value)
        {
            PropVariant v = new PropVariant { Type = VT_LPWSTR, Value = Marshal.StringToCoTaskMemUni(value) };
            try { Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref v)); }
            finally { PropVariantClear(ref v); }
        }

        /// <summary>The visible top-level browser windows of the given processes.</summary>
        public static IntPtr[] AppWindows(int[] processIds)
        {
            var ids = new HashSet<uint>();
            foreach (int id in processIds) ids.Add((uint)id);
            var found = new List<IntPtr>();
            EnumWindows((hwnd, _) =>
            {
                uint pid;
                GetWindowThreadProcessId(hwnd, out pid);
                if (!ids.Contains(pid) || !IsWindowVisible(hwnd) || GetWindow(hwnd, 4 /* GW_OWNER */) != IntPtr.Zero) return true;
                var cls = new StringBuilder(64);
                GetClassName(hwnd, cls, cls.Capacity);
                if (cls.ToString() == "Chrome_WidgetWin_1") found.Add(hwnd);
                return true;
            }, IntPtr.Zero);
            return found.ToArray();
        }

        public static string WindowAppId(IntPtr hwnd)
        {
            IPropertyStore store;
            if (SHGetPropertyStoreForWindow(hwnd, ref PropertyStoreId, out store) != 0) return null;
            try { return Get(store, AppId); }
            finally { Marshal.ReleaseComObject(store); }
        }

        /// <summary>
        /// Gives the processes' app windows the app's ID (skipping those that have it already).
        /// Only the ID: relaunch details set from outside the window's process make the taskbar
        /// drop its button. Pinning finds the Start Menu shortcut with the same ID instead.
        /// Returns how many changed.
        /// </summary>
        public static int TagWindows(int[] processIds, string appId)
        {
            int changed = 0;
            foreach (IntPtr hwnd in AppWindows(processIds))
            {
                IPropertyStore store;
                if (SHGetPropertyStoreForWindow(hwnd, ref PropertyStoreId, out store) != 0) continue;
                try
                {
                    if (Get(store, AppId) == appId) continue;
                    Set(store, AppId, appId);
                    changed++;
                }
                catch (COMException) { }
                finally { Marshal.ReleaseComObject(store); }
            }
            return changed;
        }

        /// <summary>Sets a shortcut's app ID (so a pinned shortcut and the windows share one button).</summary>
        public static bool SetShortcutAppId(string path, string appId)
        {
            var link = (IShellLinkW)new ShellLink();
            try
            {
                var file = (IPersistFile)link;
                file.Load(path, 2 /* STGM_READWRITE */);
                var store = (IPropertyStore)link;
                if (Get(store, AppId) == appId) return false;
                Set(store, AppId, appId);
                Marshal.ThrowExceptionForHR(store.Commit());
                file.Save(path, true);
                return true;
            }
            finally { Marshal.ReleaseComObject(link); }
        }

        public static void DeleteJumpList(string appId)
        {
            var list = (ICustomDestinationList)new DestinationList();
            try { list.DeleteList(appId); }
            finally { Marshal.ReleaseComObject(list); }
        }

        /// <summary>The taskbar button's right-click menu: one task, "New window".</summary>
        public static void SetJumpList(string appId, string title, string program, string arguments, string workingDirectory, string icon)
        {
            var list = (ICustomDestinationList)new DestinationList();
            try
            {
                list.SetAppID(appId);
                uint slots;
                object removed;
                Guid arrayId = typeof(IObjectArray).GUID;
                list.BeginList(out slots, ref arrayId, out removed);

                var link = (IShellLinkW)new ShellLink();
                link.SetPath(program);
                link.SetArguments(arguments);
                link.SetWorkingDirectory(workingDirectory);
                link.SetIconLocation(icon, 0);
                link.SetDescription(title);
                var store = (IPropertyStore)link;
                Set(store, Title, title);
                Marshal.ThrowExceptionForHR(store.Commit());

                var tasks = (IObjectCollection)new EnumerableObjectCollection();
                tasks.AddObject(link);
                list.AddUserTasks((IObjectArray)tasks);
                list.CommitList();
            }
            finally { Marshal.ReleaseComObject(list); }
        }
    }
}
