# keil VS Code

> **Keil 大战代码** 🥊 — VS Code 上的 Keil 辅助工具

## [English](./README_EN.md)

## 简述 📑

vscode 上的 Keil 辅助工具，与 c/c++ 插件配合使用.

能够为 Keil 项目提供 语法高亮、代码片段 的功能，并支持对 keil 项目进行 编译、下载。

**仅支持 Keil uVison 5 及以上版本（现在应该没人用比这个更古老的版本了吧……）**  

**仅支持 Windows 平台（Linux/MacOS推荐使用[Embedded IDE](https://github.com/github0null/eide)）**

> 碎碎念：EIDE功能比我这个插件更强大，如果你有专业开发需求，推荐用那个。

**原项目已经不再维护了，有问题不要在原项目提Issue！**

**原项目已经不再维护了，有问题不要在原项目提Issue！**

**原项目已经不再维护了，有问题不要在原项目提Issue！**

![preview](./res/preview/preview.png)

***

## 功能特性🎉

- 加载 Keil C51/ARM 项目，并以 Keil 项目资源管理器的展示方式显示项目视图
- 自动监视 keil 项目文件的变化，及时更新项目视图
- 通过调用 Keil 命令行接口实现 编译，重新编译，烧录 keil 项目
- 自动生成 c_cpp_properties.json 文件，使 C/C++ 插件的语法分析能正常进行
- **🎨 支持中英双语**（自动跟随 VS Code 显示语言切换）
- **📄 从模板新建工程**：将现有工程保存为模板，一键创建新工程
- **📦 Pack and Go**：将工程打包为 ZIP，支持自定义文件名和模板保存
- **⚙️ Keil 项目设置侧边栏**：在 VS Code 内直接查看和编辑 Keil Target 配置
- **🔍 函数列表**：自动扫描项目源文件，显示函数列表并支持快速跳转

***

## 用法 📖

### 准备工作

1. 安装 C/C++ 插件
>
2. 进入 keil VS Code 插件设置，设置好 keil 可执行文件 UV4.exe 的绝对路径
 
 ![setting](./res/preview/setting.png)

***

### 开始使用 🏃‍♀️

1. 在 Keil 上创建好项目，添加好文件，头文件路径等
> 
2. 点击 **打开项目** 图标 或者 **使用 vscode 直接打开 keil 项目文件(.uvproj) 所在的目录**，插件会自动加载 keil 项目；

### 常用操作

- **编译，烧录**：提供了 3 个按钮，分别代表 编译，下载，重新编译

>

- **保存和刷新**：在 Keil 上添加/删除源文件，更改，配置项目，更改完毕后点击 **保存所有**，插件检测到 keil 项目变化后会自动刷新项目

>

- **打开源文件**：单击源文件将以预览模式打开，双击源文件将切换到非预览模式打开

>

- **切换 c/c++ 插件的配置**：点击目标名称在多个 c/c++ 配置中切换

>

- **切换 keil Target**：点击项目的切换按钮，可以在多个 Keil Target 之间切换

>

- **展开引用**：在编译完成后，可以点击源文件项的箭头图标展开其引用（仅支持 ARM 项目）

>

- **从模板新建工程**：点击工具栏 📄 按钮，选择 `.KeilTemplates` 中的模板 ZIP，输入工程名称，即可快速创建新工程并自动完成工程目录和元文件重命名。

- **Pack and Go（打包工程）**：右键项目 → `Pack and Go`，支持打包整个工程或按需选择文件，可保存为 ZIP 或存入 `.KeilTemplates` 模板目录。

- **Keil 项目设置侧边栏**：在 `Keil 项目设置` 面板中可直接查看和编辑当前 Target 的编译器、链接器、输出等配置。

- **函数列表**：`函数列表` 面板自动扫描项目中的函数定义，支持搜索和跳转。

- **i18n 国际化**：自动检测 VS Code 显示语言，中英双语无缝切换。

***

### 其他设置

- 工作区设置：项目排除列表(`KeilAssistant.Project.ExcludeList`)
 当某个目录下存在多个 keil 项目时，使用插件打开该目录，插件会加载所有的 keil 项目，通过此选项，可以指定需要排除哪些 keil 项目，防止在打开该工作区时自动加载该项目
 **默认的排除列表**：
  ```json
  [
      "template.uvproj",
      "template.uvprojx"
  ]
  ```

### 还有其他问题 ？

可以到以下位置进行交流

- [论坛: https://discuss.em-ide.com/t/keil-assistant](https://discuss.em-ide.com/t/keil-assistant)

- [Github Issue: https://github.com/x-leehe/keil-VS-Code/issues](https://github.com/x-leehe/keil-VS-Code/issues)
