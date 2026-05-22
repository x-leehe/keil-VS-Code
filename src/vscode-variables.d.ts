/**
 * vscode-variables 模块类型声明
 * 该模块用于替换字符串中的 VS Code 预定义变量（如 ${workspaceFolder}）
 */
declare module 'vscode-variables' {
    function vscodeVariables(input: string | { path: string; name: string }): string;
    export = vscodeVariables;
}
