# keil VS Code

> **Keil 大战代码** 🥊 — Keil assistive tool on VS Code

## Summary 📑

Keil assistive tool on VS Code, used with C/C++ extension.

It provides **A51 assembly syntax highlighting**, **code snippets** for Keil projects, and supports **compiling and downloading** Keil projects.

**Keil uVision 5 and above is supported only**

**Windows platform only**

***

## Features 🎉

- Load Keil C51/ARM projects and display them in a tree view styled like the Keil project explorer
- Automatically monitor Keil project file changes and keep the project view up to date
- Compile, rebuild, and download Keil projects by calling the Keil command-line interface
- Auto-generate `c_cpp_properties.json` for the C/C++ extension
- Multi-target support: switch between multiple Targets within a project
- **🎨 i18n Support**: Automatically switches between Chinese and English based on VS Code display language
- **📄 New Project from Template**: Save existing projects as templates and create new projects with one click
- **📦 Pack and Go**: Package projects as ZIP with customizable filenames and template saving
- **⚙️ Keil Settings Sidebar**: View and edit Keil Target configurations directly in VS Code
- **🔍 Function List**: Auto-scan project source files for function definitions with quick search and jump
- **📝 A51 Assembly Support**: Syntax highlighting and code snippets for 8051 assembly files (`.a51`)
- **📎 File Management**: Create, import, and delete files within the project, plus folder creation
- **🔗 Header Dependencies**: Expand header dependency tree for source files after compilation
- **🔄 Auto Sync**: Detect file changes in the project directory and optionally sync them to the Keil project
- **⚠️ Problem Matchers**: Built-in problem matchers for C51, ARMCC, and GCC compiler output

***

## Usage 📖

### Preparatory work

1. Install the C/C++ extension
>
2. Go to the keil VS Code extension settings and configure the Keil executable paths:
   - **C51 projects**: Set `KeilAssistant.C51.Uv4Path` to the C51 UV4.exe path
   - **MDK/ARM projects**: Set `KeilAssistant.MDK.Uv4Path` to the MDK UV4.exe path

***

### Start 🏃‍♀️

1. Create a project in Keil, add files, header paths, etc.
>
2. Click the **Open Project** icon, or **use VS Code to directly open the directory containing the Keil project file (`.uvproj` / `.uvprojx`)** — the extension will automatically load the Keil project

### Common operations

- **Compile and download**: Three buttons are provided — compile, download, and rebuild

  Shortcuts: `F7` build, `Ctrl+Alt+F7` rebuild, `Ctrl+Alt+D` download

>

- **Save and refresh**: Add/delete source files, change project settings in Keil. Click **Save All** when done — the extension will automatically refresh the project when it detects changes

>

- **Open source files**: Single-click opens in preview mode, double-click opens in non-preview mode

>

- **Toggle C/C++ extension configuration**: Click the target name to switch between multiple C/C++ configurations

>

- **Switch Keil Target**: Click the project switch button to toggle between multiple Keil Targets

>

- **Expand header dependencies**: After compilation, click the arrow icon on a source file to expand its header dependencies (ARM projects only)

>

- **Add/Import files**: Right-click a file group or Target → `Add File` to create new C/C++/assembly/header files; use `Import File` to copy external files into the project

- **Delete file reference**: Right-click a source file → `Delete File` to remove its reference from the project (does not delete the file on disk)

- **New folder**: Right-click a file group or Target → `New Folder` to create a subfolder in the project directory

- **New Project from Template**: Click the 📄 toolbar button, select a template ZIP from `.KeilTemplates`, enter a project name, and quickly create a new project with automatic folder and metadata renaming

- **Pack and Go**: Right-click a project → `Pack and Go`. Supports packing the entire project or selecting specific files, saving as a ZIP or storing in `.KeilTemplates`

- **Keil Settings Sidebar**: View and edit compiler, linker, output, and other Target settings directly in the `Keil Project Settings` panel

- **Function List**: The `Function List` panel auto-scans for function definitions in the project, with search and jump support

- **i18n**: Automatically detects VS Code display language for seamless Chinese/English switching

***

### Other settings

- **Project exclusion list** (`KeilAssistant.Project.ExcludeList`): When multiple Keil projects exist in a directory, opening it with the extension loads all projects. Use this option to exclude specific Keil projects from auto-loading.

  **Default exclusion list**:
  ```json
  [
      "template.uvproj",
      "template.uvprojx"
  ]
  ```

- **Project file location list** (`KeilAssistant.Project.FileLocationList`): Specify additional Keil project file paths (supports VS Code variables) — the extension will also load projects from these locations

- **Pack and Go author** (`KeilAssistant.PackAndGo.Author`): Author name used in Pack and Go

- **Pack and Go name pattern** (`KeilAssistant.PackAndGo.NamePattern`): Custom ZIP filename pattern. Supports `${project}`, `${date}`, `${time}`, `${author}`, `${target}` variables

  Default: `${project}_${date}_${time}`

- **Pack and Go template path** (`KeilAssistant.PackAndGo.TemplatePath`): Custom template storage directory. If not set, defaults to `%USERPROFILE%\Documents\.KeilTemplates`

### Any other questions ?

You can go to the following places to communicate

- [Discussion: https://discuss.em-ide.com/t/keil-assistant](https://discuss.em-ide.com/t/keil-assistant)

- [Github Issue: https://github.com/x-leehe/keil-VS-Code/issues](https://github.com/x-leehe/keil-VS-Code/issues)
