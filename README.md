# keil VS Code

> **Keil 大战代码** 🥊 — VS Code 上的 Keil 辅助工具

## [English](./README_EN.md)

## 简述 📑

VS Code 上的 Keil 辅助工具，与 C/C++ 插件配合使用。

能够为 Keil 项目提供 **A51 汇编语法高亮**、**代码片段** 的功能，并支持对 Keil 项目进行 **编译、下载**。

**仅支持 Keil uVision 5 及以上版本（现在应该没人用比这个更古老的版本了吧……）**

**仅支持 Windows 平台（Linux/MacOS 推荐使用 [Embedded IDE](https://github.com/github0null/eide)）**

> 碎碎念：EIDE 功能比我这个插件更强大，如果你有专业开发需求，推荐用那个。

**原项目已经不再维护了，有问题不要在原项目提 Issue！**

**原项目已经不再维护了，有问题不要在原项目提 Issue！**

**原项目已经不再维护了，有问题不要在原项目提 Issue！**

![preview](./res/preview/preview.png)

***

## 功能特性 🎉

- 加载 Keil C51/ARM 项目，并以 Keil 项目资源管理器的展示方式显示项目视图
- 自动监视 Keil 项目文件的变化，及时更新项目视图
- 通过调用 Keil 命令行接口实现编译、重新编译、烧录 Keil 项目
- 自动生成 `c_cpp_properties.json` 文件，使 C/C++ 插件的语法分析能正常进行
- 支持多 Target 项目，可在多个 Target 之间切换
- **🎨 支持中英双语**（自动跟随 VS Code 显示语言切换）
- **📄 从模板新建工程**：将现有工程保存为模板，一键创建新工程
- **📦 Pack and Go**：将工程打包为 ZIP，支持自定义文件名和模板保存
- **⚙️ Keil 项目设置侧边栏**：在 VS Code 内直接查看和编辑 Keil Target 配置
- **🔍 函数列表**：自动扫描项目源文件，显示函数列表并支持快速跳转
- **📝 A51 汇编支持**：为 8051 汇编文件（`.a51`）提供语法高亮和代码片段
- **📎 文件管理**：支持在工程中新建、导入、删除文件，以及新建文件夹
- **🔗 头文件依赖**：编译后可展开查看源文件的头文件依赖关系
- **🔄 自动同步**：检测工程目录内文件变更，支持自动同步到 Keil 工程
- **⚠️ 问题匹配器**：支持 C51、ARMCC、GCC 编译输出的问题匹配

***

## 用法 📖

### 准备工作

1. 安装 C/C++ 插件
>
2. 进入 keil VS Code 插件设置，分别设置 Keil 可执行文件的路径：
   - **C51 项目**：设置 `KeilAssistant.C51.Uv4Path` 为 C51 的 UV4.exe 路径
   - **MDK/ARM 项目**：设置 `KeilAssistant.MDK.Uv4Path` 为 MDK 的 UV4.exe 路径

   ![setting](./res/preview/setting.png)

***

### 开始使用 🏃‍♀️

1. 在 Keil 上创建好项目，添加好文件、头文件路径等
>
2. 点击 **打开项目** 图标，或者 **使用 VS Code 直接打开 Keil 项目文件（`.uvproj` / `.uvprojx`）所在的目录**，插件会自动加载 Keil 项目

### 常用操作

- **编译、下载**：提供了 3 个按钮，分别代表 编译、下载、重新编译

  快捷键：`F7` 编译、`Ctrl+Alt+F7` 重新编译、`Ctrl+Alt+D` 下载

>

- **保存和刷新**：在 Keil 上添加/删除源文件、更改配置后，点击 **保存所有**，插件检测到 Keil 项目变化后会自动刷新项目

>

- **打开源文件**：单击源文件将以预览模式打开，双击源文件将切换到非预览模式打开

>

- **切换 C/C++ 插件的配置**：点击目标名称在多个 C/C++ 配置中切换

>

- **切换 Keil Target**：点击项目的切换按钮，可以在多个 Keil Target 之间切换

>

- **展开头文件依赖**：编译完成后，可以点击源文件项的箭头图标展开其依赖的头文件（仅支持 ARM 项目）

>

- **添加/导入文件**：右键文件组或 Target → `添加文件`，可新建 C/C++/汇编/头文件等；也可通过 `导入文件` 将外部文件复制到工程中

- **删除文件引用**：右键源文件 → `删除文件`，从工程中移除引用（不会删除磁盘文件）

- **新建文件夹**：右键文件组或 Target → `新建文件夹`，在工程目录下创建子文件夹

- **从模板新建工程**：点击工具栏 📄 按钮，选择 `.KeilTemplates` 中的模板 ZIP，输入工程名称，即可快速创建新工程并自动完成工程目录和元文件重命名

- **Pack and Go（打包工程）**：右键项目 → `Pack and Go`，支持打包整个工程或按需选择文件，可保存为 ZIP 或存入 `.KeilTemplates` 模板目录

- **Keil 项目设置侧边栏**：在 `Keil 项目设置` 面板中可直接查看和编辑当前 Target 的编译器、链接器、输出等配置

- **函数列表**：`函数列表` 面板自动扫描项目中的函数定义，支持搜索和跳转

- **i18n 国际化**：自动检测 VS Code 显示语言，中英双语无缝切换

***

### 其他设置

- **项目排除列表** (`KeilAssistant.Project.ExcludeList`)：当某个目录下存在多个 Keil 项目时，使用插件打开该目录，插件会加载所有的 Keil 项目。通过此选项，可以指定需要排除哪些 Keil 项目，防止自动加载

  **默认的排除列表**：
  ```json
  [
      "template.uvproj",
      "template.uvprojx"
  ]
  ```

- **项目文件位置列表** (`KeilAssistant.Project.FileLocationList`)：指定额外的 Keil 项目文件路径（支持 VS Code 变量），插件会自动加载这些位置的项目

- **Pack and Go 作者名** (`KeilAssistant.PackAndGo.Author`)：Pack and Go 打包时使用的作者名

- **Pack and Go 文件名模板** (`KeilAssistant.PackAndGo.NamePattern`)：自定义 ZIP 文件名，支持 `${project}`、`${date}`、`${time}`、`${author}`、`${target}` 变量

  默认值：`${project}_${date}_${time}`

- **Pack and Go 模板路径** (`KeilAssistant.PackAndGo.TemplatePath`)：自定义模板存放目录，不设置则使用 `%USERPROFILE%\Documents\.KeilTemplates`

### 还有其他问题 ？

可以到以下位置进行交流

- [论坛: https://discuss.em-ide.com/t/keil-assistant](https://discuss.em-ide.com/t/keil-assistant)

- [Github Issue: https://github.com/x-leehe/keil-VS-Code/issues](https://github.com/x-leehe/keil-VS-Code/issues)
