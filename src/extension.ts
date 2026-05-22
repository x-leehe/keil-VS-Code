import * as vscode from 'vscode';
import * as node_path from 'path';
import { File } from '../lib/node_utility/File';
import { ResourceManager } from './ResourceManager';
import { KeilSettingsProvider, SettingItem } from './KeilSettingsProvider';
import { FunctionTreeViewProvider } from './functionTreeViewProvider';
import { FuncDef } from './FunctionScanner';
import { IView } from './models';
import { ProjectExplorer } from './ProjectExplorer';

let keilSettingsProvider: KeilSettingsProvider | undefined;
let functionTreeViewProvider: FunctionTreeViewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('---- keil VS Code (Keil 大战代码) actived ----');
    ResourceManager.getInstance(context);

    keilSettingsProvider = new KeilSettingsProvider();
    const keilSettingsTree = vscode.window.createTreeView('keilSettings', {
        treeDataProvider: keilSettingsProvider
    });
    context.subscriptions.push(keilSettingsTree);

    // 双击 Keil 设置项触发编辑
    let lastKeilSettingSelection: { item: SettingItem; time: number } | undefined;
    keilSettingsTree.onDidChangeSelection(e => {
        if (e.selection.length === 1) {
            const item = e.selection[0] as SettingItem;
            if (item.contextValue === 'keilSetting' && item.editPath) {
                const now = Date.now();
                if (lastKeilSettingSelection?.item === item && now - lastKeilSettingSelection.time < 600) {
                    // 双击：触发编辑
                    vscode.commands.executeCommand('keilSettings.edit', item);
                    lastKeilSettingSelection = undefined;
                } else {
                    lastKeilSettingSelection = { item, time: now };
                }
            }
        }
    });

    functionTreeViewProvider = new FunctionTreeViewProvider();
    context.subscriptions.push(vscode.window.registerTreeDataProvider('functionTreeView', functionTreeViewProvider));

    const prjExplorer = new ProjectExplorer(context);
    prjExplorer.setContext(context);
    prjExplorer.hooks = {
        onSettingsLoad: async (prjPath: string) => { await keilSettingsProvider?.loadProject(prjPath); },
        onFunctionScan: (prjDir: string) => { functionTreeViewProvider?.scan(prjDir); }
    };

    // 扫描工作区文件夹中的 Keil 工程文件 (.uvprojx / .uvproj)
    prjExplorer.loadWorkspace();

    const subscriber = context.subscriptions;

    subscriber.push(vscode.commands.registerCommand('explorer.open', async () => {
        const uri = await vscode.window.showOpenDialog({ openLabel: 'Open a keil project', canSelectFolders: false, canSelectMany: false, filters: { 'keil project xml': ['uvproj', 'uvprojx'] } });
        try {
            if (uri && uri.length > 0) {
                const uvPrjPath = uri[0].fsPath;
                await prjExplorer.openProject(uvPrjPath);
                const result = await vscode.window.showInformationMessage('keil project load done !, switch workspace ?', 'Ok', 'Later');
                if (result === 'Ok') { openWorkspace(new File(node_path.dirname(uvPrjPath))); }
            }
        } catch (error) { vscode.window.showErrorMessage('open project failed !, msg: ' + (error as Error).message); }
    }));

    // ====== 项目操作命令 ======
    subscriber.push(vscode.commands.registerCommand('project.close', (item: IView) => prjExplorer.closeProject(item.prjID)));
    subscriber.push(vscode.commands.registerCommand('project.build', (item: IView) => prjExplorer.getTarget(item)?.build()));
    subscriber.push(vscode.commands.registerCommand('project.rebuild', (item: IView) => prjExplorer.getTarget(item)?.rebuild()));
    subscriber.push(vscode.commands.registerCommand('project.download', (item: IView) => prjExplorer.getTarget(item)?.download()));
    subscriber.push(vscode.commands.registerCommand('item.copyValue', (item: IView) => vscode.env.clipboard.writeText(item.tooltip || '')));
    subscriber.push(vscode.commands.registerCommand('project.switch', (item: IView) => prjExplorer.switchTargetByProject(item)));
    subscriber.push(vscode.commands.registerCommand('project.active', (item: IView) => prjExplorer.activeProject(item)));

    // ====== Keil 设置侧边栏命令 ======
    subscriber.push(vscode.commands.registerCommand('keilSettings.edit', async (itemData: SettingItem | any) => {
        // 从右键菜单或双击触发时，itemData 是 SettingItem 树节点
        // 兼容旧版 arguments 传递方式
        if (itemData && itemData.command && itemData.command.arguments) {
            itemData = itemData.command.arguments[0];
        }
        if (!keilSettingsProvider || !itemData) { return; }
        const editPath: string[] = itemData.editPath;
        const editType: string = itemData.editType || 'text';
        const options: string[] | undefined = itemData.editOptions;
        if (!editPath) { return; }
        const currentValue = keilSettingsProvider.getValue(editPath);
        let newValue: string | undefined;
        if (editType === 'boolean') {
            const pick = await vscode.window.showQuickPick(['是 (1)', '否 (0)'], { placeHolder: `设置 "${itemData.label}" (当前: ${currentValue === '1' ? '是' : '否'})` });
            if (pick) { newValue = pick.startsWith('是') ? '1' : '0'; }
        } else if (editType === 'select' && options) {
            newValue = await vscode.window.showQuickPick(options, { placeHolder: `选择 "${itemData.label}" (当前: ${currentValue})` });
        } else {
            newValue = await vscode.window.showInputBox({ prompt: `编辑 "${itemData.label}"`, value: currentValue, placeHolder: `输入 "${itemData.label}" 的新值`, validateInput: (val: string) => editType === 'number' && val && isNaN(Number(val)) ? '请输入有效的数字' : null });
        }
        if (newValue !== undefined) {
            keilSettingsProvider.setValue(editPath, newValue);
            await keilSettingsProvider.saveDocument();
            keilSettingsProvider.refresh();
            vscode.window.showInformationMessage(`已更新 "${itemData.label}" 为: ${newValue}`);
        }
    }));
    subscriber.push(vscode.commands.registerCommand('keilSettings.refresh', () => keilSettingsProvider?.refresh()));
    subscriber.push(vscode.commands.registerCommand('keilSettings.switchTarget', async () => {
        if (!keilSettingsProvider) { return; }
        const targets = keilSettingsProvider.getTargetNames();
        if (targets.length <= 1) { vscode.window.showInformationMessage('当前项目只有一个 Target'); return; }
        const selected = await vscode.window.showQuickPick(targets, { placeHolder: '选择要查看的 Target' });
        if (selected) { keilSettingsProvider.setTargetIndex(targets.indexOf(selected)); }
    }));
    subscriber.push(vscode.commands.registerCommand('keilSettings.loadFromProject', async () => {
        const prjPath = prjExplorer.getActiveProjectPath();
        if (prjPath) { await keilSettingsProvider?.loadProject(prjPath); vscode.window.showInformationMessage(`已加载项目设置: ${prjPath}`); }
        else { vscode.window.showWarningMessage('没有活动的 Keil 项目，请先打开项目'); }
    }));

    // ====== 文件添加/导入/依赖命令 ======
    const addFileHandler = async (item: IView, suffix: string, template?: (name: string) => string) => { await prjExplorer.addFileToGroup(item, suffix, template); };
    subscriber.push(vscode.commands.registerCommand('project.addFile.c', (item: IView) => addFileHandler(item, '.c', (name) => `/**\n * @file ${name}.c\n */\n\n#include "${name}.h"\n\n`)));
    subscriber.push(vscode.commands.registerCommand('project.addFile.cpp', (item: IView) => addFileHandler(item, '.cpp', (name) => `/**\n * @file ${name}.cpp\n */\n\n`)));
    subscriber.push(vscode.commands.registerCommand('project.addFile.asm', (item: IView) => addFileHandler(item, '.s')));
    subscriber.push(vscode.commands.registerCommand('project.addFile.asmPreprocess', (item: IView) => addFileHandler(item, '.S')));
    subscriber.push(vscode.commands.registerCommand('project.addFile.header', (item: IView) => addFileHandler(item, '.h', (name) => { const guard = `__${name.toUpperCase()}_H__`; return `#ifndef ${guard}\n#define ${guard}\n\n\n\n#endif /* ${guard} */\n`; })));
    subscriber.push(vscode.commands.registerCommand('project.addFile.text', (item: IView) => addFileHandler(item, '.txt')));
    subscriber.push(vscode.commands.registerCommand('project.addFile.other', async (item: IView) => {
        const fullName = await vscode.window.showInputBox({ prompt: '输入文件名（含扩展名）', placeHolder: '例如: readme.txt, utils.c, config.ini', validateInput: (val: string) => val.trim() ? null : '文件名不能为空' });
        if (fullName) {
            const dotIdx = fullName.lastIndexOf('.');
            const suffix = dotIdx >= 0 ? fullName.substring(dotIdx) : '';
            await prjExplorer.addFileToGroup(item, suffix, undefined, fullName);
        }
    }));

    // 导入外部文件
    subscriber.push(vscode.commands.registerCommand('project.importFile', async (item: IView) => {
        const uris = await vscode.window.showOpenDialog({ openLabel: '选择要导入的文件', canSelectFiles: true, canSelectFolders: false, canSelectMany: true });
        if (uris && uris.length > 0) { for (const uri of uris) { await prjExplorer.importFileToGroup(item, uri.fsPath); } }
    }));

    // 删除文件引用
    subscriber.push(vscode.commands.registerCommand('project.deleteFile', async (item: IView) => { await prjExplorer.deleteFile(item); }));

    // 显示/隐藏头文件依赖
    subscriber.push(vscode.commands.registerCommand('project.toggleHeaderDeps', (item: IView) => prjExplorer.setShowHeaderDeps(item.prjID, true)));
    subscriber.push(vscode.commands.registerCommand('project.hideHeaderDeps', (item: IView) => prjExplorer.setShowHeaderDeps(item.prjID, false)));
    subscriber.push(vscode.commands.registerCommand('project.toggleFileHeaderDeps', (item: IView) => prjExplorer.toggleFileHeaderDeps(item)));
    subscriber.push(vscode.commands.registerCommand('project.toggleGroupHeaderDeps', (item: IView) => prjExplorer.toggleGroupHeaderDeps(item)));

    // 重新加载工程
    subscriber.push(vscode.commands.registerCommand('project.reload', async (item: IView) => {
        const prj = prjExplorer.getProject(item.prjID);
        if (prj) {
            try { await prj.onReload(); }
            catch (err) {
                const error = err as NodeJS.ErrnoException;
                if (error.code && error.code === 'EBUSY') {
                    vscode.window.showWarningMessage('工程文件正忙，请稍后再试');
                } else {
                    vscode.window.showErrorMessage(`reload project failed !, msg: ${error.message}`);
                }
            }
        }
    }));

    // Pack and Go
    subscriber.push(vscode.commands.registerCommand('project.packAndGo', async (item: IView) => { await prjExplorer.packAndGo(item); }));

    // ====== 函数列表命令 ======
    subscriber.push(vscode.commands.registerCommand('functionTreeView.goto', (f: FuncDef) => {
        vscode.workspace.openTextDocument(f.filePath).then(doc => vscode.window.showTextDocument(doc).then(editor => {
            const pos = new vscode.Position(f.line - 1, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        }));
    }));
    subscriber.push(vscode.commands.registerCommand('functionTreeView.search', () => functionTreeViewProvider?.search()));
    subscriber.push(vscode.commands.registerCommand('functionTreeView.refresh', () => functionTreeViewProvider?.refresh()));
    subscriber.push(vscode.commands.registerCommand('functionTreeView.scanFile', async (filePath: string) => { await functionTreeViewProvider?.scanFile(filePath); }));

    // 监听活动编辑器变化，自动扫描当前文件
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && functionTreeViewProvider) {
            const filePath = editor.document.uri.fsPath;
            const ext = node_path.extname(filePath).toLowerCase();
            if (['.c', '.h', '.cpp', '.hpp', '.s', '.S', '.inc'].includes(ext)) {
                functionTreeViewProvider.scanFile(filePath);
            }
        }
    }));
}

function openWorkspace(wsFile: File): void {
    vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.parse(wsFile.ToUri()));
}

export function deactivate() { }