import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';
import { FuncDef, scanDirectory } from './FunctionScanner';

/** TreeView 节点 */
class FuncItem extends vscode.TreeItem {
    constructor(
        label: string,
        collapsible: vscode.TreeItemCollapsibleState,
        public readonly funcDef?: FuncDef,
        public readonly children?: FuncItem[]
    ) {
        super(label, collapsible);
        if (funcDef) {
            this.description = `第 ${funcDef.line} 行`;
            this.tooltip = `${funcDef.signature}\n${funcDef.filePath}`;
            this.command = {
                command: 'functionTreeView.goto',
                title: '跳转到定义',
                arguments: [funcDef]
            };
            const icon = label.startsWith('#') ? 'symbol-constant'
                : funcDef.name === funcDef.name.toUpperCase() ? 'symbol-key' : 'symbol-function';
            this.iconPath = { light: icon, dark: icon } as any;
        }
    }
}

interface IFileGroup {
    file: string;
    funcs: FuncDef[];
}

/**
 * 函数列表 TreeDataProvider
 */
export class FunctionTreeViewProvider implements vscode.TreeDataProvider<FuncItem> {

    private _onDidChangeTreeData = new vscode.EventEmitter<FuncItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private funcs: FuncDef[] = [];
    private loading = false;
    private lastProjectDir: string | undefined;

    /** 扫描项目目录 */
    async scan(projectDir: string): Promise<void> {
        this.lastProjectDir = projectDir;
        this.loading = true;

        // 异步扫描不阻塞 UI
        const results = await new Promise<FuncDef[]>((resolve) => {
            setTimeout(() => resolve(scanDirectory(projectDir)), 50);
        });

        this.funcs = results;
        this.loading = false;
        this._onDidChangeTreeData.fire(undefined);
    }

    /** 扫描当前文件 */
    async scanFile(filePath: string): Promise<void> {
        this.loading = true;
        const results = await new Promise<FuncDef[]>((resolve) => {
            setTimeout(() => {
                const fd: FuncDef[] = [];
                // 使用 scanner 的单文件扫描
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const lines = content.split('\n');
                    const pattern = /^(?:\/\*\*[\s\S]*?\*\/\s*)?(?:static\s+)?(?:inline\s+)?(?:void|int|char|float|double|long|short|unsigned|signed|bool|uint\w*_t|int\w*_t|size_t|ssize_t|volatile\s+\w+|\w+\s*\*?\s*)\s+(\w+)\s*\(/gm;
                    let match: RegExpExecArray | null;
                    while ((match = pattern.exec(content)) !== null) {
                        const name = match[1];
                        if (name && !['if', 'else', 'while', 'for', 'switch', 'case', 'return', 'sizeof'].includes(name)) {
                            const pos = match.index;
                            const line = content.substring(0, pos).split('\n').length;
                            fd.push({ name, filePath, line, signature: (lines[line - 1] || match[0]).trim() });
                        }
                    }
                } catch { /* ignore */ }
                resolve(fd);
            }, 50);
        });

        this.funcs = results;
        this.loading = false;
        this._onDidChangeTreeData.fire(undefined);
    }

    /** 按文件分组 */
    private groupByFile(): IFileGroup[] {
        const map = new Map<string, FuncDef[]>();
        for (const f of this.funcs) {
            const list = map.get(f.filePath) || [];
            list.push(f);
            map.set(f.filePath, list);
        }
        return Array.from(map.entries()).map(([file, funcs]) => ({ file, funcs }));
    }

    refresh(): void {
        if (this.lastProjectDir) {
            this.scan(this.lastProjectDir);
        } else {
            this._onDidChangeTreeData.fire(undefined);
        }
    }

    /** 获取所有函数（供搜索使用） */
    getAllFunctions(): FuncDef[] {
        return this.funcs;
    }

    /** QuickPick 实时搜索 */
    async search(): Promise<void> {
        if (this.funcs.length === 0) {
            vscode.window.showInformationMessage('没有扫描到函数，请先打开 Keil 项目。');
            return;
        }

        const allItems = this.funcs.map(f => ({
            label: f.name,
            description: `$(file-code) ${path.basename(f.filePath)}:${f.line}`,
            detail: f.signature,
            funcDef: f
        }));

        const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { funcDef: FuncDef }>();
        quickPick.title = '搜索函数';
        quickPick.placeholder = '输入关键字过滤函数名...';
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
        quickPick.canSelectMany = false;

        quickPick.onDidChangeValue((value) => {
            if (!value) {
                quickPick.items = allItems.slice(0, 50);
                return;
            }
            const lower = value.toLowerCase();
            quickPick.items = allItems.filter(item =>
                item.label.toLowerCase().includes(lower) ||
                (item.description && item.description.toLowerCase().includes(lower)) ||
                (item.detail && item.detail.toLowerCase().includes(lower))
            ).slice(0, 100);
        });

        quickPick.items = allItems.slice(0, 50);

        quickPick.onDidAccept(() => {
            const selected = quickPick.selectedItems[0];
            if (selected) {
                quickPick.hide();
                vscode.commands.executeCommand('functionTreeView.goto', selected.funcDef);
            }
        });

        quickPick.onDidHide(() => quickPick.dispose());
        quickPick.show();
    }

    getTreeItem(element: FuncItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: FuncItem): vscode.ProviderResult<FuncItem[]> {
        if (this.loading) {
            return [new FuncItem('$(sync~spin) 扫描中...', vscode.TreeItemCollapsibleState.None)];
        }
        if (this.funcs.length === 0) {
            return [new FuncItem('(无函数) 请先打开 Keil 项目', vscode.TreeItemCollapsibleState.None)];
        }
        if (!element) {
            // 根：按文件分组
            return this.groupByFile().map(g => {
                const fname = path.basename(g.file);
                return new FuncItem(fname, vscode.TreeItemCollapsibleState.Expanded, undefined,
                    g.funcs.map(f => new FuncItem(f.name, vscode.TreeItemCollapsibleState.None, f)));
            });
        }
        return element.children || [];
    }
}
