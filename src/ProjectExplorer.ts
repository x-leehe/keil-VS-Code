import * as vscode from 'vscode';
import * as fs from 'fs';
import * as node_path from 'path';
import * as xml2js from 'xml2js';
import AdmZip from 'adm-zip';
import vscodeVariables from 'vscode-variables';

import { File } from '../lib/node_utility/File';
import { ResourceManager } from './ResourceManager';
import { IView, Source, FileGroup } from './models';
import { KeilProject } from './KeilProject';
import { Target } from './Target';
import { t } from './i18n';

// ==============================================
// ProjectExplorer — 工程管理器 TreeDataProvider
// ==============================================

/** 项目打开后的回调钩子 */
export interface ProjectOpenHooks {
    /** 当项目加载完成时调用，用于同步到 Keil 设置侧边栏 */
    onSettingsLoad?: (prjPath: string) => Promise<void>;
    /** 当项目加载完成时调用，用于扫描函数列表 */
    onFunctionScan?: (prjDir: string) => void;
}

export class ProjectExplorer implements vscode.TreeDataProvider<IView> {

    private ItemClickCommand: string = 'Item.Click';

    onDidChangeTreeData: vscode.Event<IView>;
    private viewEvent: vscode.EventEmitter<IView>;

    private prjList: Map<string, KeilProject>;
    private currentActiveProject: KeilProject | undefined;
    private projectWatchers: Map<string, vscode.FileSystemWatcher>;
    private _context: vscode.ExtensionContext | undefined;

    /** 项目打开时的外部钩子 */
    hooks: ProjectOpenHooks = {};

    constructor(context: vscode.ExtensionContext) {
        this.prjList = new Map();
        this.projectWatchers = new Map();
        this.viewEvent = new vscode.EventEmitter<IView>();
        this.onDidChangeTreeData = this.viewEvent.event;

        context.subscriptions.push(vscode.window.registerTreeDataProvider('project', this));
        context.subscriptions.push(vscode.commands.registerCommand(this.ItemClickCommand, (item: IView) => this.onItemClick(item)));
    }

    async loadWorkspace(): Promise<void> {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const wsAny = vscode.workspace as any;
            const wsFilePath = wsAny.workspaceFile && /^file:/.test(wsAny.workspaceFile.toString()) ?
                node_path.dirname(wsAny.workspaceFile.fsPath) : vscode.workspace.workspaceFolders[0].uri.fsPath;
            const workspace = new File(wsFilePath);
            if (workspace.IsDir()) {
                const excludeList = ResourceManager.getInstance().getProjectExcludeList();
                const fileLocationList = ResourceManager.getInstance().getProjectFileLocationList()
                    .map((p: string) => new File(vscodeVariables(p)));
                const uvList = workspace.GetList([/\.uvproj[x]?$/i], File.EMPTY_FILTER)
                    .concat(fileLocationList)
                    .filter((file: File) => { return !excludeList.includes(file.name); });
                for (const uvFile of uvList) {
                    try {
                        await this.openProject(uvFile.path);
                    } catch (error) {
                        vscode.window.showErrorMessage(t('pe.open.failed', uvFile.name, (error as Error).message));
                    }
                }
            }
        }
        this.updateView();
    }

    async openProject(path: string): Promise<KeilProject | undefined> {
        const nPrj = new KeilProject(new File(path));
        if (!this.prjList.has(nPrj.prjID)) {
            await nPrj.load();
            nPrj.on('dataChanged', () => this.updateView());
            this.prjList.set(nPrj.prjID, nPrj);

            if (this.currentActiveProject === undefined) {
                this.currentActiveProject = nPrj;
                this.currentActiveProject.active();
            }

            vscode.commands.executeCommand('setContext', 'keilShowHeaderDeps', true);
            this.updateView();

            // 通过钩子通知外部
            if (this.hooks.onSettingsLoad) {
                await this.hooks.onSettingsLoad(nPrj.uvprjFile.path);
            }
            if (this.hooks.onFunctionScan) {
                this.hooks.onFunctionScan(nPrj.uvprjFile.dir);
            }

            // 为该工程创建文件系统监视器
            this.setupProjectWatcher(nPrj);
            return nPrj;
        }
        return undefined;
    }

    async closeProject(pID: string): Promise<void> {
        const prj = this.prjList.get(pID);
        if (prj) {
            prj.deactive();
            prj.close();
            this.prjList.delete(pID);

            const watcher = this.projectWatchers.get(pID);
            if (watcher) {
                watcher.dispose();
                this.projectWatchers.delete(pID);
            }

            this.updateView();
        }
    }

    async activeProject(view: IView): Promise<void> {
        const project = this.prjList.get(view.prjID);
        if (project) {
            this.currentActiveProject?.deactive();
            this.currentActiveProject = project;
            this.currentActiveProject?.active();
            vscode.commands.executeCommand('setContext', 'keilShowHeaderDeps', true);
            this.updateView();
        }
    }

    async switchTargetByProject(view?: IView): Promise<void> {
        const prj = view ? this.prjList.get(view.prjID) : this.currentActiveProject;
        if (prj) {
            const tList = prj.getTargets();
            const targetName = await vscode.window.showQuickPick(
                tList.map((ele: Target) => { return ele.targetName; }),
                {
                    canPickMany: false,
                    placeHolder: t('pe.switchTarget.placeHolder')
                }
            );
            if (targetName) {
                prj.setActiveTarget(targetName);
            }
        }
    }

    getTarget(view?: IView): Target | undefined {
        if (view) {
            const prj = this.prjList.get(view.prjID);
            if (prj) {
                const targets = prj.getTargets();
                const index = targets.findIndex((target: Target) => { return target.targetName === view.label; });
                if (index !== -1) {
                    return targets[index];
                }
            }
        } else {
            if (this.currentActiveProject) {
                return this.currentActiveProject.getActiveTarget();
            } else {
                vscode.window.showWarningMessage(t('pe.noActiveProject'));
            }
        }
        return undefined;
    }

    getActiveProjectPath(): string | undefined {
        if (this.currentActiveProject) {
            return this.currentActiveProject.uvprjFile.path;
        }
        const first = this.prjList.values().next().value;
        return first ? first.uvprjFile.path : undefined;
    }

    /** Pack and Go - 将工程目录压缩为 ZIP，支持自定义名称表达式、选择文件、保存为模板 */
    async packAndGo(item?: IView): Promise<void> {
        const prj = item ? this.prjList.get(item.prjID) : this.currentActiveProject;
        if (!prj) {
            vscode.window.showErrorMessage(t('pe.projectNotFound'));
            return;
        }

        const projDir = prj.uvprjFile.dir;
        const projName = prj.uvprjFile.noSuffixName;
        const resMgr = ResourceManager.getInstance();

        // ---- Step 1: 选择打包范围 ----
        const scopePick = await vscode.window.showQuickPick(
            [
                { label: t('pe.packAndGo.scope.package'), description: t('pe.packAndGo.scope.package.desc'), scope: 'all' },
                { label: t('pe.packAndGo.scope.partial'), description: t('pe.packAndGo.scope.partial.desc'), scope: 'partial' },
            ],
            { placeHolder: t('pe.packAndGo.scope.placeHolder') }
        );
        if (!scopePick) { return; }

        const isPartial = scopePick.scope === 'partial';
        let selectedFiles: string[] | undefined; // 相对于 projDir 的路径

        if (isPartial) {
            const allFiles = this.collectProjectFiles(projDir);
            if (allFiles.length === 0) {
                vscode.window.showWarningMessage(t('pe.packAndGo.noFiles'));
                return;
            }
            const picked = await vscode.window.showQuickPick(
                allFiles.map(f => ({ label: f.relPath, description: f.sizeKB, picked: f.isSource })),
                { canPickMany: true, placeHolder: t('pe.packAndGo.pickFiles'), matchOnDescription: true }
            );
            if (!picked || picked.length === 0) { return; }
            selectedFiles = picked.map(p => p.label);
        }

        // ---- Step 2: 输入自定义名称 ----
        const namePattern = resMgr.getPackAndGoNamePattern();
        const resolvedExample = this.resolvePackName(namePattern, projName, prj);
        const customName = await vscode.window.showInputBox({
            prompt: t('pe.packAndGo.namePrompt'),
            value: namePattern,
            placeHolder: t('pe.packAndGo.nameExample', resolvedExample),
            validateInput: (val: string) => val.trim() ? null : t('ext.addFile.emptyName')
        });
        if (!customName) { return; }

        const resolvedName = this.resolvePackName(customName.trim(), projName, prj);

        // ---- Step 3: 选择保存类型（普通 / 模板） ----
        const savePick = await vscode.window.showQuickPick(
            [
                { label: t('pe.packAndGo.save.normal'), description: t('pe.packAndGo.save.normal.desc'), mode: 'normal' as const },
                { label: t('pe.packAndGo.save.template'), description: t('pe.packAndGo.save.template.desc'), mode: 'template' as const },
            ],
            { placeHolder: t('pe.packAndGo.save.placeHolder') }
        );
        if (!savePick) { return; }

        const isTemplate = savePick.mode === 'template';
        let outputDir: string;

        if (isTemplate) {
            const customTemplatePath = resMgr.getPackAndGoTemplatePath();
            if (customTemplatePath) {
                outputDir = customTemplatePath;
            } else {
                const homeDir = process.env.USERPROFILE || process.env.HOME || '~';
                outputDir = node_path.join(homeDir, 'Documents', '.KeilTemplates');
            }
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
        } else {
            outputDir = node_path.dirname(projDir);
        }

        const zipPath = node_path.join(outputDir, `${resolvedName}.zip`);

        // 检查是否已存在
        if (fs.existsSync(zipPath)) {
            const overwrite = await vscode.window.showWarningMessage(
                t('pe.packAndGo.overwrite', resolvedName),
                t('pe.btn.overwrite'), t('pe.btn.cancel')
            );
            if (overwrite !== t('pe.btn.overwrite')) { return; }
        }

        // ---- Step 4: 执行打包 ----
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: t('pe.packAndGo.progress.title'),
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ message: t('pe.packAndGo.progress.compressing') });

                    const zip = new AdmZip();
                    if (isPartial && selectedFiles) {
                        for (const relPath of selectedFiles) {
                            const absPath = node_path.join(projDir, relPath);
                            if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
                                // 保持相对目录结构
                                zip.addLocalFile(absPath, node_path.dirname(node_path.join(projName, relPath)));
                            }
                        }
                    } else {
                        zip.addLocalFolder(projDir, projName);
                    }
                    zip.writeZip(zipPath);
                }
            );

            const stat = fs.statSync(zipPath);
            const sizeMB = (stat.size / (1024 * 1024)).toFixed(2);
            const msg = isTemplate
                ? t('pe.packAndGo.template.saved', sizeMB, zipPath)
                : t('pe.packAndGo.normal.done', sizeMB, zipPath);

            const action = await vscode.window.showInformationMessage(msg, t('pe.packAndGo.reveal'));
            if (action === t('pe.packAndGo.reveal')) {
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(zipPath));
            }
        } catch (err) {
            vscode.window.showErrorMessage(t('pe.packAndGo.failed', (err as Error).message));
        }
    }

    /** 从模板新建工程 —— 选择模板、定义名称、解压并重命名 */
    async newFromTemplate(): Promise<void> {
        const resMgr = ResourceManager.getInstance();

        // ---- Step 1: 定位模板目录 ----
        const customTemplatePath = resMgr.getPackAndGoTemplatePath();
        let templateDir: string;
        if (customTemplatePath) {
            templateDir = customTemplatePath;
        } else {
            const homeDir = process.env.USERPROFILE || process.env.HOME || '~';
            templateDir = node_path.join(homeDir, 'Documents', '.KeilTemplates');
        }

        if (!fs.existsSync(templateDir)) {
            vscode.window.showWarningMessage(
                t('pe.template.dirNotFound', templateDir)
            );
            return;
        }

        // ---- Step 2: 列出可用模板 ----
        const zipFiles = fs.readdirSync(templateDir)
            .filter(f => /\.zip$/i.test(f))
            .map(f => {
                const fullPath = node_path.join(templateDir, f);
                let sizeStr = '';
                try {
                    const st = fs.statSync(fullPath);
                    sizeStr = st.size < 1024 * 1024
                        ? `${(st.size / 1024).toFixed(1)} KB`
                        : `${(st.size / (1024 * 1024)).toFixed(1)} MB`;
                } catch { /* ignore */ }
                return { label: f, description: sizeStr, path: fullPath };
            });

        if (zipFiles.length === 0) {
            vscode.window.showWarningMessage(
                t('pe.template.noZip')
            );
            return;
        }

        const pickedTemplate = await vscode.window.showQuickPick(zipFiles, {
            placeHolder: t('pe.template.pick'),
            matchOnDescription: true
        });
        if (!pickedTemplate) { return; }

        // ---- Step 3: 输入新工程名称 ----
        const newProjectName = await vscode.window.showInputBox({
            prompt: t('pe.template.namePrompt'),
            placeHolder: t('pe.template.namePlaceholder'),
            validateInput: (val: string) => {
                if (!val.trim()) { return t('pe.template.nameEmpty'); }
                if (/[<>:"/\\|?*]/.test(val)) { return t('pe.template.nameInvalid'); }
                return null;
            }
        });
        if (!newProjectName) { return; }

        // ---- Step 4: 选择目标文件夹 ----
        const targetFolderUris = await vscode.window.showOpenDialog({
            openLabel: t('pe.template.selectDir.label'),
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            title: t('pe.template.selectDir.title')
        });
        if (!targetFolderUris || targetFolderUris.length === 0) { return; }

        const targetDir = targetFolderUris[0].fsPath;
        const newProjectDir = node_path.join(targetDir, newProjectName);

        // 检查目标目录是否已存在
        if (fs.existsSync(newProjectDir)) {
            const overwrite = await vscode.window.showWarningMessage(
                t('pe.template.dirExists', newProjectName),
                { modal: true },
                t('pe.btn.overwrite'), t('pe.btn.cancel')
            );
            if (overwrite !== t('pe.btn.overwrite')) { return; }
            fs.rmSync(newProjectDir, { recursive: true, force: true });
        }

        // ---- Step 5: 解压并重命名 ----
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: t('pe.template.progress.title'),
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ message: t('pe.template.progress.extracting') });

                    // 先解压到临时目录
                    const tmpDir = node_path.join(targetDir, `.keil_tmp_${Date.now()}`);
                    fs.mkdirSync(tmpDir, { recursive: true });

                    const zip = new AdmZip(pickedTemplate.path);
                    zip.extractAllTo(tmpDir, true);

                    progress.report({ message: t('pe.template.progress.renaming') });

                    // ZIP 内部结构：{oldProjectName}/file1, file2, ...
                    const entries = fs.readdirSync(tmpDir);
                    let oldProjectName = '';
                    const uvprojRegex = /\.uvproj[x]?$/i;

                    // 找到原始工程名（通过 ZIP 内的顶层文件夹）
                    for (const entry of entries) {
                        const entryPath = node_path.join(tmpDir, entry);
                        if (fs.statSync(entryPath).isDirectory()) {
                            oldProjectName = entry;
                            break;
                        }
                    }

                    if (!oldProjectName) {
                        // 如果没有顶层文件夹，说明 ZIP 直接打包了文件
                        // 直接将 tmpDir 重命名为目标目录
                        fs.renameSync(tmpDir, newProjectDir);
                    } else {
                        const oldProjectFullPath = node_path.join(tmpDir, oldProjectName);

                        // 重命名 uvproj/uvprojx 文件
                        const projectFiles = fs.readdirSync(oldProjectFullPath)
                            .filter(f => uvprojRegex.test(f));

                        for (const pf of projectFiles) {
                            const oldPath = node_path.join(oldProjectFullPath, pf);
                            const ext = node_path.extname(pf);
                            const newPf = newProjectName + ext;
                            const newPath = node_path.join(oldProjectFullPath, newPf);
                            fs.renameSync(oldPath, newPath);

                            // 更新 uvproj/uvprojx 内的 <ProjectName> 标签
                            try {
                                let content = fs.readFileSync(newPath, 'utf-8');
                                const projectNameRegex = new RegExp(
                                    `(<ProjectName>)\\s*${oldProjectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(</ProjectName>)`,
                                    'gi'
                                );
                                content = content.replace(projectNameRegex, `$1${newProjectName}$2`);
                                fs.writeFileSync(newPath, content, 'utf-8');
                            } catch { /* 非 XML 格式则跳过 */ }
                        }

                        // 重命名 uvopt/uvoptx 文件（如果存在）
                        const optFiles = fs.readdirSync(oldProjectFullPath)
                            .filter(f => /\.uvopt[x]?$/i.test(f));
                        for (const of of optFiles) {
                            const oldPath = node_path.join(oldProjectFullPath, of);
                            const ext = node_path.extname(of);
                            const newOf = newProjectName + ext;
                            const newPath = node_path.join(oldProjectFullPath, newOf);
                            fs.renameSync(oldPath, newPath);
                        }

                        // 将旧工程目录重命名为新工程名
                        const renamedOldDir = node_path.join(tmpDir, newProjectName);
                        fs.renameSync(oldProjectFullPath, renamedOldDir);

                        // 移动到目标位置
                        fs.renameSync(renamedOldDir, newProjectDir);
                    }

                    // 清理临时目录
                    if (fs.existsSync(tmpDir)) {
                        try { fs.rmdirSync(tmpDir); } catch { /* ignore */ }
                    }
                }
            );

            const action = await vscode.window.showInformationMessage(
                t('pe.template.created', newProjectName, newProjectDir),
                t('pe.template.openProject'), t('pe.template.openFolder')
            );

            if (action === t('pe.template.openProject')) {
                // 查找并打开 uvproj/uvprojx 文件
                const uvprojRegex = /\.uvproj[x]?$/i;
                const files = fs.readdirSync(newProjectDir)
                    .filter(f => uvprojRegex.test(f));
                if (files.length > 0) {
                    const prjPath = node_path.join(newProjectDir, files[0]);
                    await this.openProject(prjPath);
                    const result = await vscode.window.showInformationMessage(
                        t('pe.template.loadDone'),
                        t('pe.template.switch'), t('pe.template.later')
                    );
                    if (result === t('pe.template.switch')) {
                        vscode.commands.executeCommand(
                            'vscode.openFolder',
                            vscode.Uri.file(newProjectDir)
                        );
                    }
                }
            } else if (action === t('pe.template.openFolder')) {
                vscode.commands.executeCommand(
                    'revealFileInOS',
                    vscode.Uri.file(newProjectDir)
                );
            }
        } catch (err) {
            vscode.window.showErrorMessage(
                t('pe.template.failed', (err as Error).message)
            );
        }
    }

    /** 递归收集项目目录下所有文件（排除 .vscode 和常见构建产物） */
    private collectProjectFiles(projDir: string): { relPath: string; sizeKB: string; isSource: boolean }[] {
        const results: { relPath: string; sizeKB: string; isSource: boolean }[] = [];
        const excludeDirs = new Set(['.vscode', 'Listings', 'Objects', 'DebugConfig', '.git', 'node_modules', '__pycache__']);
        const sourceExts = new Set(['.c', '.h', '.cpp', '.hpp', '.s', '.S', '.asm', '.a51', '.txt', '.ini', '.uvproj', '.uvprojx', '.uvoptx', '.uvopt', '.md']);

        const walk = (dir: string, relBase: string) => {
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch { return; }
            for (const entry of entries) {
                if (entry.name.startsWith('.') && entry.name !== '.') { continue; }
                const absPath = node_path.join(dir, entry.name);
                const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    if (excludeDirs.has(entry.name)) { continue; }
                    walk(absPath, relPath);
                } else if (entry.isFile()) {
                    const ext = node_path.extname(entry.name).toLowerCase();
                    const isObj = ['.o', '.obj', '.d', '.crf', '.axf', '.hex', '.bin', '.elf', '.map', '.lnp', '.lst', '.iex'].includes(ext);
                    if (isObj) { continue; }
                    let sizeKB = '';
                    try {
                        const st = fs.statSync(absPath);
                        sizeKB = st.size < 1024 ? `${st.size} B` : `${(st.size / 1024).toFixed(1)} KB`;
                    } catch { /* ignore */ }
                    results.push({ relPath, sizeKB, isSource: sourceExts.has(ext) });
                }
            }
        };

        walk(projDir, '');
        // 源码文件排前面
        results.sort((a, b) => (b.isSource ? 1 : 0) - (a.isSource ? 1 : 0));
        return results;
    }

    /** 解析文件名表达式 */
    private resolvePackName(pattern: string, projName: string, prj: KeilProject): string {
        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        const author = ResourceManager.getInstance().getPackAndGoAuthor() || 'unknown';
        const activeTarget = prj.getActiveTarget();
        const target = activeTarget ? activeTarget.targetName : '';

        return pattern
            .replace(/\$\{project\}/g, projName)
            .replace(/\$\{name\}/g, projName)
            .replace(/\$\{date\}/g, date)
            .replace(/\$\{time\}/g, time)
            .replace(/\$\{author\}/g, author)
            .replace(/\$\{target\}/g, target)
            .replace(/[<>:"/\\|?*]/g, '_'); // 移除非法文件名字符
    }

    getProject(prjID: string): KeilProject | undefined {
        return this.prjList.get(prjID);
    }

    /** 向指定 FileGroup 添加新文件 */
    /** 获取操作目标目录：FileGroup → 组名子目录，Target → 项目根目录 */
    private getGroupDir(prj: KeilProject, item: IView): string {
        if (item.contextVal === 'Target') {
            return prj.uvprjFile.dir;
        }
        return node_path.join(prj.uvprjFile.dir, item.label);
    }

    /** 获取组名（用于更新 uvproj）：Target → 空字符串跳过更新 */
    private getGroupName(item: IView): string {
        return item.contextVal === 'Target' ? '' : item.label;
    }

    async addFileToGroup(
        item: IView,
        suffix: string,
        template?: (name: string) => string,
        baseName?: string
    ): Promise<void> {
        const prj = this.prjList.get(item.prjID);
        if (!prj) {
            vscode.window.showErrorMessage(t('pe.projectNotFound'));
            return;
        }

        const isTarget = item.contextVal === 'Target';
        const fileName = baseName || await vscode.window.showInputBox({
            prompt: t('pe.addFile.prompt', suffix),
            placeHolder: t('pe.addFile.placeHolder'),
            validateInput: (val: string) => val.trim() ? null : t('ext.addFile.emptyName')
        });
        if (!fileName) {
            return;
        }

        const fullName = fileName.endsWith(suffix) ? fileName : fileName + suffix;
        const groupDir = this.getGroupDir(prj, item);
        if (!fs.existsSync(groupDir)) {
            fs.mkdirSync(groupDir, { recursive: true });
        }

        const filePath = node_path.join(groupDir, fullName);
        if (fs.existsSync(filePath)) {
            const overwrite = await vscode.window.showWarningMessage(
                t('pe.addFile.exists', fullName),
                t('pe.btn.overwrite'), t('pe.btn.cancel')
            );
            if (overwrite !== t('pe.btn.overwrite')) {
                return;
            }
        }

        const content = template ? template(fileName) : '';
        fs.writeFileSync(filePath, content, 'utf-8');

        if (!isTarget) {
            await this.updateUvprojFileList(prj, item.label, fullName, filePath);
        }

        try {
            await prj.onReload();
        } catch {
            this.updateView();
        }

        this.updateView();
        vscode.window.showInformationMessage(t('pe.addFile.created', fullName));

        const doc = await vscode.workspace.openTextDocument(filePath);
        vscode.window.showTextDocument(doc);
    }

    /** 在 FileGroup 或 Target 下新建子文件夹，同时写入 uvproj 元文件 */
    async addFolderToGroup(item: IView): Promise<void> {
        const prj = this.prjList.get(item.prjID);
        if (!prj) {
            vscode.window.showErrorMessage(t('pe.projectNotFound'));
            return;
        }

        const folderName = await vscode.window.showInputBox({
            prompt: t('pe.addFolder.prompt'),
            placeHolder: t('pe.addFolder.placeHolder'),
            validateInput: (val: string) => val.trim() ? null : t('pe.template.nameEmpty')
        });
        if (!folderName) {
            return;
        }

        const groupDir = this.getGroupDir(prj, item);
        const folderPath = node_path.join(groupDir, folderName);

        if (fs.existsSync(folderPath)) {
            vscode.window.showWarningMessage(t('pe.addFolder.exists', folderName));
            return;
        }

        fs.mkdirSync(folderPath, { recursive: true });

        // 写入 uvproj 元文件：为所有 Target 添加新的 Group
        try {
            await this.addGroupToUvproj(prj, folderName);
            vscode.window.showInformationMessage(t('pe.addGroup.created', folderName));
        } catch (err) {
            vscode.window.showErrorMessage(t('pe.template.failed', (err as Error).message));
        }

        try { await prj.onReload(); } catch { /* ignore */ }
        this.updateView();
    }

    /** 导入外部文件到指定 FileGroup */
    async importFileToGroup(item: IView, sourcePath: string): Promise<void> {
        const prj = this.prjList.get(item.prjID);
        if (!prj) {
            vscode.window.showErrorMessage(t('pe.projectNotFound'));
            return;
        }

        const srcFile = new File(sourcePath);
        if (!srcFile.IsFile()) {
            vscode.window.showErrorMessage(t('pe.importFile.notFound', sourcePath));
            return;
        }

        const groupDir = node_path.join(prj.uvprjFile.dir, item.label);
        if (!fs.existsSync(groupDir)) {
            fs.mkdirSync(groupDir, { recursive: true });
        }

        const destPath = node_path.join(groupDir, srcFile.name);
        if (fs.existsSync(destPath)) {
            const action = await vscode.window.showWarningMessage(
                t('pe.importFile.exists', srcFile.name),
                t('pe.btn.overwrite'), t('pe.importFile.skip')
            );
            if (action === t('pe.importFile.skip')) {
                return;
            }
        }

        fs.copyFileSync(sourcePath, destPath);
        await this.updateUvprojFileList(prj, item.label, srcFile.name, destPath);
    }

    /** 从工程中删除文件 */
    async deleteFile(item: IView): Promise<void> {
        const source = item as unknown as Source;
        if (!source || !source.file) {
            return;
        }

        const prj = this.prjList.get(item.prjID);
        if (!prj) {
            vscode.window.showErrorMessage(t('pe.projectNotFound'));
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            t('pe.deleteFile.confirm', source.file.name),
            { modal: true },
            t('pe.deleteFile.btn'), t('pe.btn.cancel')
        );
        if (confirm !== t('pe.deleteFile.btn')) {
            return;
        }

        await this.removeFileFromUvproj(prj, source.file.name);

        try {
            await prj.onReload();
        } catch {
            // 忽略重新加载错误
        }

        this.updateView();
        vscode.window.showInformationMessage(t('pe.deleteFile.done', source.file.name));
    }

    /** 从 .uvprojx 中移除指定文件 */
    async removeFileFromUvproj(prj: KeilProject, fileName: string): Promise<void> {
        const parser = new xml2js.Parser({ explicitArray: false });
        const uvContent = fs.readFileSync(prj.uvprjFile.path, 'utf-8');
        const doc = await parser.parseStringPromise(uvContent);

        const targets = doc['Project']['Targets']['Target'];
        const targetList = Array.isArray(targets) ? targets : [targets];

        for (const target of targetList) {
            const groups = target['Groups']?.['Group'];
            const groupList = Array.isArray(groups) ? groups : (groups ? [groups] : []);
            for (const group of groupList) {
                let fileList = group['Files']?.['File'];
                if (!fileList) {
                    continue;
                }
                if (!Array.isArray(fileList)) {
                    fileList = [fileList];
                }
                group['Files']['File'] = fileList.filter((f: any) => f['FileName'] !== fileName);
            }
        }

        const builder = new xml2js.Builder({
            xmldec: { version: '1.0', encoding: 'UTF-8', standalone: false },
            renderOpts: { pretty: true, indent: '  ', newline: '\n' }
        });
        fs.writeFileSync(prj.uvprjFile.path, builder.buildObject(doc), 'utf-8');
    }

    /** 更新 .uvprojx 中指定 Group 的文件列表 */
    async updateUvprojFileList(
        prj: KeilProject,
        groupName: string,
        fileName: string,
        _filePath: string
    ): Promise<void> {
        const parser = new xml2js.Parser({ explicitArray: false });
        const uvContent = fs.readFileSync(prj.uvprjFile.path, 'utf-8');
        const doc = await parser.parseStringPromise(uvContent);

        const targets = doc['Project']['Targets']['Target'];
        const targetList = Array.isArray(targets) ? targets : [targets];

        const ext = node_path.extname(fileName).toLowerCase();
        let fileType = '1'; // 默认 C 源码
        if (['.s', '.S', '.asm', '.a51'].includes(ext)) {
            fileType = '2'; // 汇编
        } else if (['.h', '.hpp', '.hxx', '.inc'].includes(ext)) {
            fileType = '5'; // 头文件
        } else if (['.lib', '.a'].includes(ext)) {
            fileType = '4'; // 库文件
        }

        for (const target of targetList) {
            const groups = target['Groups']?.['Group'];
            const groupList = Array.isArray(groups) ? groups : (groups ? [groups] : []);
            for (const group of groupList) {
                if (group['GroupName'] === groupName) {
                    if (!group['Files']) {
                        group['Files'] = {};
                    }
                    let fileList = group['Files']['File'];
                    if (!fileList) {
                        fileList = [];
                    } else if (!Array.isArray(fileList)) {
                        fileList = [fileList];
                    }

                    const exists = fileList.some((f: any) => f['FilePath'] === `.\\${groupName}\\${fileName}`);
                    if (!exists) {
                        fileList.push({
                            FileName: fileName,
                            FileType: fileType,
                            FilePath: `.\\${groupName}\\${fileName}`
                        });
                        group['Files']['File'] = fileList;
                    }
                }
            }
        }

        const builder = new xml2js.Builder({
            xmldec: { version: '1.0', encoding: 'UTF-8', standalone: false },
            renderOpts: { pretty: true, indent: '  ', newline: '\n' }
        });
        fs.writeFileSync(prj.uvprjFile.path, builder.buildObject(doc), 'utf-8');
    }

    /** 向 uvproj XML 中所有 Target 添加一个新的空 Group */
    private async addGroupToUvproj(prj: KeilProject, groupName: string): Promise<void> {
        const parser = new xml2js.Parser({ explicitArray: false });
        const uvContent = fs.readFileSync(prj.uvprjFile.path, 'utf-8');
        const doc = await parser.parseStringPromise(uvContent);

        const targets = doc['Project']['Targets']['Target'];
        const targetList = Array.isArray(targets) ? targets : [targets];

        for (const target of targetList) {
            if (!target['Groups']) {
                target['Groups'] = {};
            }
            let groups = target['Groups']['Group'];
            if (!groups) {
                groups = [];
            } else if (!Array.isArray(groups)) {
                groups = [groups];
            }

            // 检查是否已存在同名 Group
            const exists = groups.some((g: any) => g['GroupName'] === groupName);
            if (!exists) {
                groups.push({
                    GroupName: groupName,
                    Files: {}
                });
            }
            target['Groups']['Group'] = groups;
        }

        const builder = new xml2js.Builder({
            xmldec: { version: '1.0', encoding: 'UTF-8', standalone: false },
            renderOpts: { pretty: true, indent: '  ', newline: '\n' }
        });
        fs.writeFileSync(prj.uvprjFile.path, builder.buildObject(doc), 'utf-8');
    }

    /** 从所有 Target 中删除一个文件组 */
    async deleteGroup(item: IView): Promise<void> {
        const prj = this.prjList.get(item.prjID);
        if (!prj) {
            vscode.window.showErrorMessage(t('pe.projectNotFound'));
            return;
        }

        const groupName = item.label;
        const confirm = await vscode.window.showWarningMessage(
            t('pe.deleteGroup.confirm', groupName),
            { modal: true },
            t('pe.btn.delete'), t('pe.btn.cancel')
        );
        if (confirm !== t('pe.btn.delete')) { return; }

        try {
            const parser = new xml2js.Parser({ explicitArray: false });
            const uvContent = fs.readFileSync(prj.uvprjFile.path, 'utf-8');
            const doc = await parser.parseStringPromise(uvContent);

            const targets = doc['Project']['Targets']['Target'];
            const targetList = Array.isArray(targets) ? targets : [targets];
            for (const target of targetList) {
                if (!target['Groups']) { continue; }
                let groups = target['Groups']['Group'];
                if (!groups) { continue; }
                if (!Array.isArray(groups)) { groups = [groups]; }
                target['Groups']['Group'] = groups.filter((g: any) => g['GroupName'] !== groupName);
            }

            const builder = new xml2js.Builder({
                xmldec: { version: '1.0', encoding: 'UTF-8', standalone: false },
                renderOpts: { pretty: true, indent: '  ', newline: '\n' }
            });
            fs.writeFileSync(prj.uvprjFile.path, builder.buildObject(doc), 'utf-8');

            await prj.onReload();
            this.updateView();
            vscode.window.showInformationMessage(t('pe.deleteGroup.done', groupName));
        } catch (err) {
            vscode.window.showErrorMessage(t('pe.toggleGroupInclude.failed', (err as Error).message));
        }
    }

    /** 切换文件组的 IncludeInBuild 状态（排除/恢复整个组参与编译） */
    async toggleGroupInclude(item: IView): Promise<void> {
        const prj = this.prjList.get(item.prjID);
        if (!prj) {
            vscode.window.showErrorMessage(t('pe.projectNotFound'));
            return;
        }

        const groupName = item.label;
        try {
            const parser = new xml2js.Parser({ explicitArray: false });
            const uvContent = fs.readFileSync(prj.uvprjFile.path, 'utf-8');
            const doc = await parser.parseStringPromise(uvContent);

            const targets = doc['Project']['Targets']['Target'];
            const targetList = Array.isArray(targets) ? targets : [targets];
            let newState = false;

            for (const target of targetList) {
                if (!target['Groups']) { continue; }
                let groups = target['Groups']['Group'];
                if (!groups) { continue; }
                if (!Array.isArray(groups)) { groups = [groups]; }

                const group = groups.find((g: any) => g['GroupName'] === groupName);
                if (!group) { continue; }

                if (!group['GroupOption']) {
                    group['GroupOption'] = { CommonProperty: {} };
                }
                if (!group['GroupOption']['CommonProperty']) {
                    group['GroupOption']['CommonProperty'] = {};
                }
                const current = group['GroupOption']['CommonProperty']['IncludeInBuild'];
                const newValue = current === '0' ? '1' : '0';
                group['GroupOption']['CommonProperty']['IncludeInBuild'] = newValue;
                newState = newValue === '1';
            }

            const builder = new xml2js.Builder({
                xmldec: { version: '1.0', encoding: 'UTF-8', standalone: false },
                renderOpts: { pretty: true, indent: '  ', newline: '\n' }
            });
            fs.writeFileSync(prj.uvprjFile.path, builder.buildObject(doc), 'utf-8');

            await prj.onReload();
            this.updateView();

            if (newState) {
                vscode.window.showInformationMessage(t('pe.toggleGroupInclude.included', groupName));
            } else {
                vscode.window.showInformationMessage(t('pe.toggleGroupInclude.excluded', groupName));
            }
        } catch (err) {
            vscode.window.showErrorMessage(t('pe.toggleGroupInclude.failed', (err as Error).message));
        }
    }

    /** 切换文件的 IncludeInBuild 状态（排除/恢复编译） */
    async toggleFileInclude(item: IView): Promise<void> {
        const source = item as unknown as Source;
        if (!source || !source.file) {
            return;
        }

        const prj = this.prjList.get(item.prjID);
        if (!prj) {
            vscode.window.showErrorMessage(t('pe.projectNotFound'));
            return;
        }

        try {
            const parser = new xml2js.Parser({ explicitArray: false });
            const uvContent = fs.readFileSync(prj.uvprjFile.path, 'utf-8');
            const doc = await parser.parseStringPromise(uvContent);

            const targets = doc['Project']['Targets']['Target'];
            const targetList = Array.isArray(targets) ? targets : [targets];
            const fileName = source.file.name;

            let newState = false;

            for (const target of targetList) {
                const groups = target['Groups']?.['Group'];
                const groupList = Array.isArray(groups) ? groups : (groups ? [groups] : []);
                for (const group of groupList) {
                    if (!group['Files']) { continue; }
                    let fileList = group['Files']['File'];
                    if (!fileList) { continue; }
                    if (!Array.isArray(fileList)) { fileList = [fileList]; }

                    for (const file of fileList) {
                        if (file['FileName'] === fileName || file['FilePath']?.endsWith(fileName)) {
                            if (!file['FileOption']) {
                                file['FileOption'] = { CommonProperty: {} };
                            }
                            if (!file['FileOption']['CommonProperty']) {
                                file['FileOption']['CommonProperty'] = {};
                            }
                            const current = file['FileOption']['CommonProperty']['IncludeInBuild'];
                            const newValue = current === '0' ? '1' : '0';
                            file['FileOption']['CommonProperty']['IncludeInBuild'] = newValue;
                            newState = newValue === '1';
                        }
                    }
                }
            }

            const builder = new xml2js.Builder({
                xmldec: { version: '1.0', encoding: 'UTF-8', standalone: false },
                renderOpts: { pretty: true, indent: '  ', newline: '\n' }
            });
            fs.writeFileSync(prj.uvprjFile.path, builder.buildObject(doc), 'utf-8');

            await prj.onReload();
            this.updateView();

            if (newState) {
                vscode.window.showInformationMessage(t('pe.toggleFileInclude.included', fileName));
            } else {
                vscode.window.showInformationMessage(t('pe.toggleFileInclude.excluded', fileName));
            }
        } catch (err) {
            vscode.window.showErrorMessage(t('pe.toggleFileInclude.failed', (err as Error).message));
        }
    }

    /** 切换头文件依赖关系显示 */
    setShowHeaderDeps(prjID: string, show: boolean): void {
        const prj = this.prjList.get(prjID);
        if (prj) {
            const targets = prj.getTargets();
            for (const target of targets) {
                if (show) {
                    target.updateSourceRefs();
                } else {
                    const fGroups = target.getChildViews() as FileGroup[] | undefined;
                    if (fGroups) {
                        for (const group of fGroups) {
                            for (const source of group.sources) {
                                source.children = undefined;
                            }
                        }
                    }
                }
            }
            vscode.commands.executeCommand('setContext', 'keilShowHeaderDeps', show);
            this.updateView();
        }
    }

    /** 切换头文件依赖关系显示（根据当前状态反转） */
    toggleHeaderDeps(prjID: string): void {
        const prj = this.prjList.get(prjID);
        if (prj) {
            const targets = prj.getTargets();
            // 检查当前是否已显示：看第一个 target 的第一个 group 的第一个文件是否有 children
            let currentlyShown = false;
            if (targets.length > 0) {
                const fGroups = targets[0].getChildViews() as FileGroup[] | undefined;
                if (fGroups && fGroups.length > 0 && fGroups[0].sources.length > 0) {
                    currentlyShown = fGroups[0].sources[0].children !== undefined;
                }
            }
            this.setShowHeaderDeps(prjID, !currentlyShown);
        }
    }

    /** 切换单个文件的头文件依赖关系显示 */
    toggleFileHeaderDeps(item: IView): void {
        const prj = this.prjList.get(item.prjID);
        if (!prj) {
            return;
        }

        let targetSource: Source | undefined;
        const targets = prj.getTargets();
        for (const target of targets) {
            const fGroups = target.getChildViews() as FileGroup[] | undefined;
            if (fGroups) {
                for (const group of fGroups) {
                    const found = group.sources.find((s: Source) => s.label === item.label);
                    if (found) {
                        targetSource = found;
                        break;
                    }
                }
            }
            if (targetSource) {
                break;
            }
        }

        if (!targetSource) {
            vscode.window.showWarningMessage('找不到对应文件');
            return;
        }

        const isHidden = targetSource.children === undefined;
        if (isHidden) {
            const activeTarget = targets[0];
            if (activeTarget) {
                activeTarget.updateSourceRefs();
                vscode.window.showInformationMessage(`已显示 "${item.label}" 的依赖关系`);
            }
        } else {
            targetSource.children = undefined;
            vscode.window.showInformationMessage(`已隐藏 "${item.label}" 的依赖关系`);
        }
        this.updateView();
    }

    /** 切换整个文件夹的文件依赖关系显示 */
    toggleGroupHeaderDeps(item: IView): void {
        const prj = this.prjList.get(item.prjID);
        if (!prj) {
            return;
        }

        let allHidden = true;
        const targets = prj.getTargets();
        const target = targets.length > 0 ? targets[0] : undefined;
        if (!target) {
            return;
        }

        const fGroups = target.getChildViews() as FileGroup[] | undefined;
        if (!fGroups) {
            return;
        }

        const group = fGroups.find((g) => g.label === item.label);
        if (!group) {
            return;
        }

        for (const source of group.sources) {
            if (source.children !== undefined) {
                allHidden = false;
                break;
            }
        }

        if (allHidden) {
            target.updateSourceRefs();
            vscode.window.showInformationMessage(`已显示 "${item.label}" 的依赖关系`);
        } else {
            for (const source of group.sources) {
                source.children = undefined;
            }
            vscode.window.showInformationMessage(`已隐藏 "${item.label}" 的依赖关系`);
        }
        this.updateView();
    }

    /** 为单个工程创建文件系统监视器 */
    private setupProjectWatcher(prj: KeilProject): void {
        const oldWatcher = this.projectWatchers.get(prj.prjID);
        if (oldWatcher) {
            oldWatcher.dispose();
        }

        const syncModeKey = `keilAutoSync_${prj.prjID}`;
        const pattern = `**/*.{c,cpp,h,hpp,s,S,asm,a51,txt}`;
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(prj.uvprjFile.dir, pattern)
        );

        let debounceTimer: NodeJS.Timeout | undefined;
        const pendingCreates = new Set<string>();
        const pendingDeletes = new Set<string>();

        const onFileChange = (uri: vscode.Uri, eventType: 'create' | 'delete') => {
            const relPath = node_path.relative(prj.uvprjFile.dir, uri.fsPath);
            if (eventType === 'create') {
                pendingCreates.add(relPath);
            } else {
                pendingDeletes.add(relPath);
            }

            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
            debounceTimer = setTimeout(async () => {
                const autoSync = this._context?.workspaceState.get<boolean>(syncModeKey, false);
                if (autoSync) {
                    const result = await vscode.window.showInformationMessage(
                        '文件结构发生变动，已同步',
                        '以后请询问我', '本次不同步'
                    );
                    if (result === '以后请询问我') {
                        this._context?.workspaceState.update(syncModeKey, false);
                        vscode.window.showInformationMessage('已恢复为「每次询问」模式');
                    } else if (result === '本次不同步') {
                        pendingCreates.clear();
                        pendingDeletes.clear();
                        return;
                    }
                    await this.syncFileChanges(prj, pendingCreates, pendingDeletes);
                } else {
                    const result = await vscode.window.showWarningMessage(
                        '检测到工程目录内文件结构发生变化，是否将更改同步到工程？',
                        '是', '否', '是，以后不再询问'
                    );
                    if (result === '是') {
                        await this.syncFileChanges(prj, pendingCreates, pendingDeletes);
                    } else if (result === '是，以后不再询问') {
                        this._context?.workspaceState.update(syncModeKey, true);
                        await this.syncFileChanges(prj, pendingCreates, pendingDeletes);
                        vscode.window.showInformationMessage('已设置为自动同步模式');
                    }
                }
            }, 1000);
        };

        watcher.onDidCreate((uri: vscode.Uri) => onFileChange(uri, 'create'));
        watcher.onDidDelete((uri: vscode.Uri) => onFileChange(uri, 'delete'));

        this.projectWatchers.set(prj.prjID, watcher);
    }

    /** 将文件变更同步到 .uvprojx */
    private async syncFileChanges(
        prj: KeilProject,
        creates: Set<string>,
        deletes: Set<string>
    ): Promise<void> {
        try {
            for (const relPath of deletes) {
                const fileName = node_path.basename(relPath);
                await this.removeFileFromUvproj(prj, fileName);
            }
            for (const relPath of creates) {
                const segs = relPath.split(node_path.sep);
                const groupName = segs.length > 1 ? segs[0] : '';
                const fileName = node_path.basename(relPath);
                const absPath = node_path.join(prj.uvprjFile.dir, relPath);
                await this.updateUvprojFileList(prj, groupName, fileName, absPath);
            }
            await prj.onReload();
        } catch (err) {
            vscode.window.showErrorMessage(`同步文件变更失败: ${(err as Error).message}`);
        } finally {
            creates.clear();
            deletes.clear();
        }
    }

    setContext(ctx: vscode.ExtensionContext): void {
        this._context = ctx;
    }

    updateView(): void {
        this.viewEvent.fire(undefined as unknown as IView);
        vscode.commands.executeCommand('setContext', 'keilAssistant.hasProject', this.prjList.size > 0);
    }

    private itemClickInfo: { name: string; time: number } | undefined;

    private async onItemClick(item: IView): Promise<void> {
        switch (item.contextVal) {
            case 'Source': {
                const source = item as unknown as Source;
                const file = new File(node_path.normalize(source.file.path));
                if (file.IsFile()) {
                    let isPreview = true;
                    if (this.itemClickInfo &&
                        this.itemClickInfo.name === file.path &&
                        this.itemClickInfo.time + 260 > Date.now()) {
                        isPreview = false;
                    }
                    this.itemClickInfo = {
                        name: file.path,
                        time: Date.now()
                    };
                    vscode.window.showTextDocument(vscode.Uri.parse(file.ToUri()), { preview: isPreview });
                } else {
                    vscode.window.showWarningMessage(`Not found file: ${source.file.path}`);
                }
                break;
            }
            default:
                break;
        }
    }

    getTreeItem(element: IView): vscode.TreeItem {
        // 被排除编译的文件/组：添加 [已排除] 前缀
        let label: string = element.label;
        if (element instanceof Source && !element.enable) {
            label = t('pe.label.excluded', element.label);
        } else if (element instanceof FileGroup && element.excluded) {
            label = t('pe.label.excluded', element.label);
        }

        const collapsible = element.getChildViews() === undefined ?
            vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed;
        const res = new vscode.TreeItem(label, collapsible);
        res.contextValue = element.contextVal;
        res.tooltip = element.tooltip;

        if (element instanceof Source) {
            res.command = {
                title: element.label,
                command: this.ItemClickCommand,
                arguments: [element]
            };
        }

        if (element.icons) {
            res.iconPath = undefined;
        }

        return res;
    }

    getChildren(element?: IView): vscode.ProviderResult<IView[]> {
        if (element === undefined) {
            if (this.prjList.size === 0) {
                return this.getWelcomeItems();
            }
            return Array.from(this.prjList.values());
        } else {
            return element.getChildViews();
        }
    }

    /** 欢迎页：未打开工程时显示提示文本（操作按钮在标题栏） */
    private getWelcomeItems(): IView[] {
        return [{
            prjID: '__welcome__',
            label: t('welcome.noProject'),
            tooltip: t('welcome.noProject'),
            contextVal: 'welcome',
            getChildViews: () => undefined
        }, {
            prjID: '__welcome__',
            label: t('welcome.hint'),
            tooltip: t('welcome.hint'),
            contextVal: 'welcome',
            getChildViews: () => undefined
        }];
    }
}
