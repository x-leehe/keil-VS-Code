# keil VS Code

> **Keil 大战代码** 🥊 — Keil assistive tool on VS Code

## Summary 📑

Keil assistive tool on VS Code, used with C/C++ plug-in.

It provides syntax highlighting, code snippets for Keil projects, and supports compiling and downloading Keil projects.

**Keil uVison 5 and above is supported only**  

**Windows platform only**

***

## Features 🎉

- Load the Keil C51/ARM project and display the project view as the Keil project style
- Automatically monitor keil project files for changes and keep project views up to date
- Compile, recompile, and burn Keil projects by calling the Keil command-line interface
- Automatically generate c_cpp_property.json for C/C++ plug-in
- **🎨 i18n Support**: Automatically switches between Chinese and English based on VS Code display language
- **📄 New Project from Template**: Save existing projects as templates and create new projects with one click
- **📦 Pack and Go**: Package projects as ZIP with customizable filenames and template saving
- **⚙️ Keil Settings Sidebar**: View and edit Keil Target configurations directly in VS Code
- **🔍 Function List**: Auto-scan project source files for function definitions with quick search and jump

***

## Usage 📖

### Preparatory work

1. Install the C/C++ plug-in
>
2. Go to the keil VS Code plug-in Settings and set the absolute path of the Keil executable uv4.exe

***

### Start 🏃‍♀️

1. Create a project on Keil, add files, header path, etc
> 
2. Click **Open the Project** icon or **Use Vscode to directly open the directory where keil project file (.uvproj) is located**, and the keil project will be automatically loaded by the plug-in;

### Common operations

- **Compile and burn**：Three buttons are provided, one for compile, one for download, and one for recompile

>

- **Save and refresh**：Add/delete the source file, change and configure the project on Keil. Click **Save all** when the change is finished. The plug-in will automatically refresh the project when it detects the change of the Keil project

>

- **Open source file**：Clicking the source file will open it in preview mode, and double-clicking the source file will switch it to non-preview mode

>

- **Toggle the C/C++ plug-in configuration**：Click the target name to toggle between multiple C/C++ configurations

>

- **Switch keil Target**：Click the project toggle button to toggle between multiple Keil targets

>

- **Show reference**：After compilation is complete, you can expand the reference by clicking on the arrow icon for the source item (ARM project only)

>

- **New Project from Template**: Click the 📄 toolbar button, select a template ZIP from `.KeilTemplates`, enter a project name, and quickly create a new project with automatic folder and metadata renaming.

- **Pack and Go**: Right-click project → `Pack and Go`. Supports packing entire project or selecting files, saving as ZIP or storing in `.KeilTemplates`.

- **Keil Settings Sidebar**: View and edit compiler, linker, output, and other Target settings directly in the `Keil Project Settings` panel.

- **Function List**: The `Function List` panel auto-scans for function definitions in the project, with search and jump support.

- **i18n**: Automatically detects VS Code display language for seamless Chinese/English switching.

***

### Other settings

- Workspace Settings: Project exclusion list(`KeilAssistant.Project.ExcludeList`)
 When there are multiple Keil projects in a directory, open it with the plug-in, and the plug-in loads all keil projects. This option allows you to specify which Keil projects you want to exclude, preventing the project from being automatically loaded when the workspace is opened
 **The default exclusion list**：
  ```json
  [
      "template.uvproj",
      "template.uvprojx"
  ]
  ```

### Any other questions ?

You can go to the following places to communicate

- [Discussion: https://discuss.em-ide.com/t/keil-assistant](https://discuss.em-ide.com/t/keil-assistant)

- [Github Issue: https://github.com/x-leehe/keil-VS-Code/issues](https://github.com/x-leehe/keil-VS-Code/issues)