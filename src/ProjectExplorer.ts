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
                        vscode.window.showErrorMessage(`open project: '${uvFile.name}' failed !, msg: ${(error as Error).message}`);
                    }
                }
            }
        }
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
            this.updateView();
        }
    }

    async switchTargetByProject(view: IView): Promise<void> {
        const prj = this.prjList.get(view.prjID);
        if (prj) {
            const tList = prj.getTargets();
            const targetName = await vscode.window.showQuickPick(
                tList.map((ele: Target) => { return ele.targetName; }),
                {
                    canPickMany: false,
                    placeHolder: 'please select a target name for keil project'
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
                vscode.window.showWarningMessage('Not found any active project !');
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
    async packAndGo(item: IView): Promise<void> {
        const prj = this.prjList.get(item.prjID);
        if (!prj) {
            vscode.window.showErrorMessage('找不到对应的 Keil 项目');
            return;
        }

        const projDir = prj.uvprjFile.dir;
        const projName = prj.uvprjFile.noSuffixName;
        const resMgr = ResourceManager.getInstance();

        // ---- Step 1: 选择打包范围 ----
        const scopePick = await vscode.window.showQuickPick(
            [
                { label: '$(package) 保存整个工程', description: '打包项目目录下的所有文件', scope: 'all' },
                { label: '$(list-selection) 仅选择部分文件', description: '手动勾选需要打包的文件', scope: 'partial' },
            ],
            { placeHolder: '选择 Pack and Go 打包范围' }
        );
        if (!scopePick) { return; }

        const isPartial = scopePick.scope === 'partial';
        let selectedFiles: string[] | undefined; // 相对于 projDir 的路径

        if (isPartial) {
            const allFiles = this.collectProjectFiles(projDir);
            if (allFiles.length === 0) {
                vscode.window.showWarningMessage('项目目录下没有找到可打包的文件');
                return;
            }
            const picked = await vscode.window.showQuickPick(
                allFiles.map(f => ({ label: f.relPath, description: f.sizeKB, picked: f.isSource })),
                { canPickMany: true, placeHolder: '选择要打包的文件（可多选）', matchOnDescription: true }
            );
            if (!picked || picked.length === 0) { return; }
            selectedFiles = picked.map(p => p.label);
        }

        // ---- Step 2: 输入自定义名称 ----
        const namePattern = resMgr.getPackAndGoNamePattern();
        const resolvedExample = this.resolvePackName(namePattern, projName, prj);
        const customName = await vscode.window.showInputBox({
            prompt: '输入 ZIP 文件名（支持表达式：${project} ${date} ${time} ${author} ${target}）',
            value: namePattern,
            placeHolder: `例如: ${resolvedExample}.zip`,
            validateInput: (val: string) => val.trim() ? null : '文件名不能为空'
        });
        if (!customName) { return; }

        const resolvedName = this.resolvePackName(customName.trim(), projName, prj);

        // ---- Step 3: 选择保存类型（普通 / 模板） ----
        const savePick = await vscode.window.showQuickPick(
            [
                { label: '$(folder) 保存到项目同级目录', description: '保存为普通 ZIP 包', mode: 'normal' as const },
                { label: '$(symbol-folder) 保存为模板', description: '存入 .KeilTemplates 模板目录，供以后复用', mode: 'template' as const },
            ],
            { placeHolder: '选择保存方式' }
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
                `文件 "${resolvedName}.zip" 已存在，是否覆盖？`,
                '覆盖', '取消'
            );
            if (overwrite !== '覆盖') { return; }
        }

        // ---- Step 4: 执行打包 ----
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Pack and Go',
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ message: '正在压缩...' });

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
                ? `模板已保存！(${sizeMB} MB)\n${zipPath}`
                : `Pack and Go 完成！(${sizeMB} MB)\n${zipPath}`;

            const action = await vscode.window.showInformationMessage(msg, '打开所在文件夹');
            if (action === '打开所在文件夹') {
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(zipPath));
            }
        } catch (err) {
            vscode.window.showErrorMessage(`Pack and Go 失败: ${(err as Error).message}`);
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
    async addFileToGroup(
        item: IView,
        suffix: string,
        template?: (name: string) => string,
        baseName?: string
    ): Promise<void> {
        const prj = this.prjList.get(item.prjID);
        if (!prj) {
            vscode.window.showErrorMessage('找不到对应的 Keil 项目');
            return;
        }

        const fileName = baseName || await vscode.window.showInputBox({
            prompt: `新建${suffix}文件`,
            placeHolder: `输入文件名（不含扩展名）`,
            validateInput: (val: string) => val.trim() ? null : '文件名不能为空'
        });
        if (!fileName) {
            return;
        }

        const fullName = fileName.endsWith(suffix) ? fileName : fileName + suffix;
        const groupDir = node_path.join(prj.uvprjFile.dir, item.label);
        if (!fs.existsSync(groupDir)) {
            fs.mkdirSync(groupDir, { recursive: true });
        }

        const filePath = node_path.join(groupDir, fullName);
        if (fs.existsSync(filePath)) {
            const overwrite = await vscode.window.showWarningMessage(
                `文件 "${fullName}" 已存在，是否覆盖？`,
                '覆盖', '取消'
            );
            if (overwrite !== '覆盖') {
                return;
            }
        }

        const content = template ? template(fileName) : '';
        fs.writeFileSync(filePath, content, 'utf-8');

        await this.updateUvprojFileList(prj, item.label, fullName, filePath);

        try {
            await prj.onReload();
        } catch {
            // 忽略重新加载错误，直接刷新视图
            this.updateView();
        }

        this.updateView();
        vscode.window.showInformationMessage(`已创建文件: ${fullName}`);

        const doc = await vscode.workspace.openTextDocument(filePath);
        vscode.window.showTextDocument(doc);
    }

    /** 导入外部文件到指定 FileGroup */
    async importFileToGroup(item: IView, sourcePath: string): Promise<void> {
        const prj = this.prjList.get(item.prjID);
        if (!prj) {
            vscode.window.showErrorMessage('找不到对应的 Keil 项目');
            return;
        }

        const srcFile = new File(sourcePath);
        if (!srcFile.IsFile()) {
            vscode.window.showErrorMessage(`找不到文件: ${sourcePath}`);
            return;
        }

        const groupDir = node_path.join(prj.uvprjFile.dir, item.label);
        if (!fs.existsSync(groupDir)) {
            fs.mkdirSync(groupDir, { recursive: true });
        }

        const destPath = node_path.join(groupDir, srcFile.name);
        if (fs.existsSync(destPath)) {
            const action = await vscode.window.showWarningMessage(
                `文件 "${srcFile.name}" 已存在于目标目录，是否覆盖？`,
                '覆盖', '跳过'
            );
            if (action === '跳过') {
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
            vscode.window.showErrorMessage('找不到对应的 Keil 项目');
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `确定要删除文件 "${source.file.name}" 吗？\n此操作将从工程中移除引用（不会删除磁盘文件）。`,
            { modal: true },
            '删除引用', '取消'
        );
        if (confirm !== '删除引用') {
            return;
        }

        await this.removeFileFromUvproj(prj, source.file.name);

        try {
            await prj.onReload();
        } catch {
            // 忽略重新加载错误
        }

        this.updateView();
        vscode.window.showInformationMessage(`已从工程中移除: ${source.file.name}`);
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
            this.updateView();
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
        const res = new vscode.TreeItem(element.label);
        res.contextValue = element.contextVal;
        res.tooltip = element.tooltip;
        res.collapsibleState = element.getChildViews() === undefined ?
            vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed;

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
            return Array.from(this.prjList.values());
        } else {
            return element.getChildViews();
        }
    }
}
