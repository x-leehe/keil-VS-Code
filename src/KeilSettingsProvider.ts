import * as vscode from 'vscode';
import * as fs from 'fs';
import * as xml2js from 'xml2js';
import { t } from './i18n';

/**
 * Keil 项目设置项侧边栏 TreeDataProvider
 * 展示 .uvprojx 中的各项配置，并支持编辑
 */
export class KeilSettingsProvider implements vscode.TreeDataProvider<SettingItem> {

    private _onDidChangeTreeData: vscode.EventEmitter<SettingItem | undefined> = new vscode.EventEmitter<SettingItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<SettingItem | undefined> = this._onDidChangeTreeData.event;

    private uvprojPath: string | undefined;
    private projectDoc: any | undefined;
    private targetIndex: number = 0;

    constructor() { }

    /** 加载指定 uvprojx 文件 */
    async loadProject(uvprojPath: string): Promise<void> {
        this.uvprojPath = uvprojPath;
        this.targetIndex = 0;
        await this.reloadDocument();
        this.refresh();
    }

    /** 设置当前活动的 Target 索引 */
    setTargetIndex(index: number): void {
        this.targetIndex = index;
        this._onDidChangeTreeData.fire(undefined);
    }

    getTargetIndex(): number {
        return this.targetIndex;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    /** 重新读取 XML 文档 */
    private async reloadDocument(): Promise<void> {
        if (!this.uvprojPath) { return; }
        const parser = new xml2js.Parser({ explicitArray: false });
        const xmlContent = fs.readFileSync(this.uvprojPath, 'utf-8');
        this.projectDoc = await parser.parseStringPromise(xmlContent);
    }

    /** 获取当前 Target 的 DOM */
    private getTargetDOM(): any {
        if (!this.projectDoc) { return undefined; }
        const targets = this.projectDoc['Project']['Targets']['Target'];
        if (Array.isArray(targets)) {
            return targets[this.targetIndex] || targets[0];
        }
        return targets;
    }

    /** 获取 Target 列表 */
    getTargetNames(): string[] {
        if (!this.projectDoc) { return []; }
        const targets = this.projectDoc['Project']['Targets']['Target'];
        if (Array.isArray(targets)) {
            return targets.map((t: any) => t['TargetName']);
        }
        return targets ? [targets['TargetName']] : [];
    }

    getTreeItem(element: SettingItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SettingItem): SettingItem[] {
        if (!this.projectDoc) {
            return [new SettingItem(t('ks.noProject'), '', vscode.TreeItemCollapsibleState.None)];
        }

        const targetDOM = this.getTargetDOM();
        if (!targetDOM) {
            return [new SettingItem(t('ks.noTarget'), '', vscode.TreeItemCollapsibleState.None)];
        }

        if (!element) {
            // 根节点：返回设置分类
            return this.getRootCategories(targetDOM);
        }

        return element.getChildren(targetDOM);
    }

    /** 获取根分类 */
    private getRootCategories(targetDOM: any): SettingItem[] {
        return [
            new CategoryItem(t('ks.cat.targetInfo'), 'targetInfo', vscode.TreeItemCollapsibleState.Expanded),
            new CategoryItem(t('ks.cat.cCompiler'), 'cCompiler', vscode.TreeItemCollapsibleState.Collapsed),
            new CategoryItem(t('ks.cat.assembler'), 'assembler', vscode.TreeItemCollapsibleState.Collapsed),
            new CategoryItem(t('ks.cat.linker'), 'linker', vscode.TreeItemCollapsibleState.Collapsed),
            new CategoryItem(t('ks.cat.output'), 'output', vscode.TreeItemCollapsibleState.Collapsed),
            new CategoryItem(t('ks.cat.memory'), 'memory', vscode.TreeItemCollapsibleState.Collapsed),
            new CategoryItem(t('ks.cat.debug'), 'debug', vscode.TreeItemCollapsibleState.Collapsed),
        ];
    }

    /** 保存 XML 文档到文件 */
    async saveDocument(): Promise<void> {
        if (!this.uvprojPath || !this.projectDoc) { return; }
        const builder = new xml2js.Builder({
            xmldec: { version: '1.0', encoding: 'UTF-8', standalone: false },
            renderOpts: { pretty: true, indent: '  ', newline: '\n' }
        });
        const xml = builder.buildObject(this.projectDoc);
        fs.writeFileSync(this.uvprojPath, xml, 'utf-8');
    }

    /** 获取设置值 (通过路径) */
    getValue(path: string[]): string {
        const targetDOM = this.getTargetDOM();
        if (!targetDOM) { return ''; }
        let current = targetDOM;
        for (const key of path) {
            if (current === undefined || current === null) { return ''; }
            current = current[key];
        }
        return current !== undefined && current !== null ? String(current) : '';
    }

    /** 设置值 (通过路径) */
    setValue(path: string[], value: string): void {
        const targetDOM = this.getTargetDOM();
        if (!targetDOM) { return; }
        let current = targetDOM;
        for (let i = 0; i < path.length - 1; i++) {
            if (current[path[i]] === undefined) {
                current[path[i]] = {};
            }
            current = current[path[i]];
        }
        const lastKey = path[path.length - 1];
        current[lastKey] = value;
    }
}

//============ Tree Item 基类 ============

export class SettingItem extends vscode.TreeItem {

    /** 编辑路径（用于 keilSettings.edit 命令） */
    editPath?: string[];
    /** 编辑类型 */
    editType?: 'text' | 'select' | 'boolean' | 'number';
    /** 下拉选项 */
    editOptions?: string[];

    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    ) {
        super(label, collapsibleState);
    }

    getChildren(_targetDOM: any): SettingItem[] {
        return [];
    }
}

//============ 分类节点 ============

class CategoryItem extends SettingItem {
    private category: string;

    constructor(label: string, category: string, collapsible: vscode.TreeItemCollapsibleState) {
        super(label, '', collapsible);
        this.category = category;
    }

    getChildren(targetDOM: any): SettingItem[] {
        switch (this.category) {
            case 'targetInfo': return getTargetInfoItems(targetDOM);
            case 'cCompiler': return getCCompilerItems(targetDOM);
            case 'assembler': return getAsmItems(targetDOM);
            case 'linker': return getLinkerItems(targetDOM);
            case 'output': return getOutputItems(targetDOM);
            case 'memory': return getMemoryItems(targetDOM);
            case 'debug': return getDebugItems(targetDOM);
            default: return [];
        }
    }
}

//============ 可编辑设置项 ============

/** 创建可编辑的设置项（简化工厂） */
function editable(label: string, value: string, editPath: string[], editType?: 'text' | 'select' | 'boolean' | 'number', options?: string[]): SettingItem {
    const item = new SettingItem(label, value, vscode.TreeItemCollapsibleState.None);
    item.tooltip = `${label}: ${value}`;
    item.contextValue = 'keilSetting';
    item.editPath = editPath;
    item.editType = editType || 'text';
    item.editOptions = options;
    item.iconPath = { light: 'edit', dark: 'edit' } as any;
    return item;
}

/** 仅展示的只读设置项（不可编辑） */
function readonlyItem(label: string, value: string): SettingItem {
    const item = new SettingItem(label, value, vscode.TreeItemCollapsibleState.None);
    item.tooltip = `${label}: ${value}`;
    return item;
}

//============ 各组设置项构造函数 ============

function getTargetInfoItems(targetDOM: any): SettingItem[] {
    const items: SettingItem[] = [];
    const tco = ['TargetOption', 'TargetCommonOption'];

    items.push(readonlyItem(t('ks.label.targetName'), targetDOM['TargetName'] || ''));
    items.push(readonlyItem(t('ks.label.device'), getNested(targetDOM, ...tco, 'Device') || ''));
    items.push(readonlyItem(t('ks.label.vendor'), getNested(targetDOM, ...tco, 'Vendor') || ''));
    items.push(readonlyItem(t('ks.label.cpu'), extractText(getNested(targetDOM, ...tco, 'Cpu')) || ''));
    items.push(readonlyItem(t('ks.label.packId'), getNested(targetDOM, ...tco, 'PackID') || ''));
    items.push(readonlyItem(t('ks.label.compilerVersion'), getNested(targetDOM, 'pCCUsed') || ''));
    items.push(readonlyItem(t('ks.label.useArmClang'), targetDOM['uAC6'] === '1' ? '是' : '否'));

    return items;
}

function getCCompilerItems(targetDOM: any): SettingItem[] {
    const items: SettingItem[] = [];
    const isArm = targetDOM['ToolsetName'] && targetDOM['ToolsetName'].includes('ARM');

    if (isArm) {
        const base = ['TargetOption', 'TargetArmAds', 'Cads'];
        const cads = getNested(targetDOM, ...base);
        if (cads) {
            items.push(editable(t('ks.label.optimization') + ' (-O)', cads['Optim'] || '1', [...base, 'Optim'], 'number'));
            items.push(editable(t('ks.label.optTime'), cads['oTime'] === '1' ? '是' : '否', [...base, 'oTime'], 'boolean'));
            items.push(editable(t('ks.label.warnLevel'), cads['wLevel'] || '2', [...base, 'wLevel'], 'number'));
            items.push(editable(t('ks.label.c99'), cads['uC99'] === '1' ? '是' : '否', [...base, 'uC99'], 'boolean'));
            items.push(editable(t('ks.label.gnuExt'), cads['uGnu'] === '1' ? '是' : '否', [...base, 'uGnu'], 'boolean'));
            items.push(editable(t('ks.label.strictAnsi'), cads['Strict'] === '1' ? '是' : '否', [...base, 'Strict'], 'boolean'));
            items.push(editable(t('ks.label.enumInt'), cads['EnumInt'] === '1' ? '是' : '否', [...base, 'EnumInt'], 'boolean'));
            items.push(editable(t('ks.label.oneElf'), cads['OneElfS'] === '1' ? '是' : '否', [...base, 'OneElfS'], 'boolean'));
            items.push(editable(t('ks.label.thumb'), cads['uThumb'] === '1' ? '是' : '否', [...base, 'uThumb'], 'boolean'));
            items.push(editable(t('ks.label.rtti'), cads['v6Rtti'] === '1' ? '是' : '否', [...base, 'v6Rtti'], 'boolean'));

            const ctrlBase = [...base, 'VariousControls'];
            const ctrl = cads['VariousControls'];
            if (ctrl) {
                items.push(editable(t('ks.label.includePath'), ctrl['IncludePath'] || '', [...ctrlBase, 'IncludePath']));
                items.push(editable(t('ks.label.define'), ctrl['Define'] || '', [...ctrlBase, 'Define']));
                items.push(editable(t('ks.label.undefine'), ctrl['Undefine'] || '', [...ctrlBase, 'Undefine']));
                items.push(editable(t('ks.label.misc'), ctrl['MiscControls'] || '', [...ctrlBase, 'MiscControls']));
            }
        }
    } else {
        const base = ['TargetOption', 'Target51', 'C51'];
        const c51 = getNested(targetDOM, ...base);
        if (c51) {
            items.push(editable(t('ks.label.optimization'), c51['Optim'] || '1', [...base, 'Optim'], 'number'));
            items.push(editable(t('ks.label.warnLevel'), c51['wLevel'] || '2', [...base, 'wLevel'], 'number'));
            const ctrlBase = [...base, 'VariousControls'];
            const ctrl = c51['VariousControls'];
            if (ctrl) {
                items.push(editable(t('ks.label.includePath'), ctrl['IncludePath'] || '', [...ctrlBase, 'IncludePath']));
                items.push(editable(t('ks.label.define'), ctrl['Define'] || '', [...ctrlBase, 'Define']));
            }
        }
    }

    return items;
}

function getAsmItems(targetDOM: any): SettingItem[] {
    const items: SettingItem[] = [];
    const isArm = targetDOM['ToolsetName'] && targetDOM['ToolsetName'].includes('ARM');

    if (isArm) {
        const base = ['TargetOption', 'TargetArmAds', 'Aads'];
        const aads = getNested(targetDOM, ...base);
        if (aads) {
            items.push(editable(t('ks.label.optimization'), aads['interw'] || '0', [...base, 'interw'], 'number'));
            items.push(editable(t('ks.label.thumb'), aads['thumb'] === '1' ? '是' : '否', [...base, 'thumb'], 'boolean'));
            items.push(editable(t('ks.label.ropi'), aads['Ropi'] === '1' ? '是' : '否', [...base, 'Ropi'], 'boolean'));
            items.push(editable(t('ks.label.rwpi'), aads['Rwpi'] === '1' ? '是' : '否', [...base, 'Rwpi'], 'boolean'));
            items.push(editable(t('ks.label.noWarn'), aads['NoWarn'] === '1' ? '是' : '否', [...base, 'NoWarn'], 'boolean'));
            const ctrlBase = [...base, 'VariousControls'];
            const ctrl = aads['VariousControls'];
            if (ctrl) {
                items.push(editable(t('ks.label.define'), ctrl['Define'] || '', [...ctrlBase, 'Define']));
                items.push(editable(t('ks.label.includePath'), ctrl['IncludePath'] || '', [...ctrlBase, 'IncludePath']));
                items.push(editable(t('ks.label.misc'), ctrl['MiscControls'] || '', [...ctrlBase, 'MiscControls']));
            }
        }
    }

    return items;
}

function getLinkerItems(targetDOM: any): SettingItem[] {
    const items: SettingItem[] = [];
    const isArm = targetDOM['ToolsetName'] && targetDOM['ToolsetName'].includes('ARM');

    if (isArm) {
        const base = ['TargetOption', 'TargetArmAds', 'LDads'];
        const ldad = getNested(targetDOM, ...base);
        if (ldad) {
            items.push(editable(t('ks.label.scatter'), ldad['ScatterFile'] || '', [...base, 'ScatterFile']));
            items.push(editable(t('ks.label.ropi'), ldad['Ropi'] === '1' ? '是' : '否', [...base, 'Ropi'], 'boolean'));
            items.push(editable(t('ks.label.rwpi'), ldad['Rwpi'] === '1' ? '是' : '否', [...base, 'Rwpi'], 'boolean'));
            items.push(editable(t('ks.label.noStdlib'), ldad['noStLib'] === '1' ? '是' : '否', [...base, 'noStLib'], 'boolean'));
            items.push(editable(t('ks.label.textAddr'), ldad['TextAddressRange'] || '', [...base, 'TextAddressRange']));
            items.push(editable(t('ks.label.dataAddr'), ldad['DataAddressRange'] || '', [...base, 'DataAddressRange']));
            items.push(editable(t('ks.label.extraLib'), ldad['IncludeLibs'] || '', [...base, 'IncludeLibs']));
            items.push(editable(t('ks.label.libPath'), ldad['IncludeLibsPath'] || '', [...base, 'IncludeLibsPath']));
            items.push(editable(t('ks.label.linkMisc'), ldad['Misc'] || '', [...base, 'Misc']));
        }
    } else {
        const base = ['TargetOption', 'Target51', 'BL51'];
        const bl51 = getNested(targetDOM, ...base);
        if (bl51) {
            items.push(editable(t('ks.label.codeAddr'), bl51['CodeStart'] || '', [...base, 'CodeStart']));
            items.push(editable(t('ks.label.xdataAddr'), bl51['XDataStart'] || '', [...base, 'XDataStart']));
        }
    }

    return items;
}

function getOutputItems(targetDOM: any): SettingItem[] {
    const items: SettingItem[] = [];
    const base = ['TargetOption', 'TargetCommonOption'];
    const tco = getNested(targetDOM, ...base);
    if (tco) {
        items.push(editable(t('ks.label.outDir'), tco['OutputDirectory'] || '', [...base, 'OutputDirectory']));
        items.push(editable(t('ks.label.outName'), tco['OutputName'] || '', [...base, 'OutputName']));
        items.push(editable(t('ks.label.genExec'), tco['CreateExecutable'] === '1' ? '是' : '否', [...base, 'CreateExecutable'], 'boolean'));
        items.push(editable(t('ks.label.genLib'), tco['CreateLib'] === '1' ? '是' : '否', [...base, 'CreateLib'], 'boolean'));
        items.push(editable('生成 Hex 文件', tco['CreateHexFile'] === '1' ? '是' : '否', [...base, 'CreateHexFile'], 'boolean'));
        items.push(editable('包含调试信息', tco['DebugInformation'] === '1' ? '是' : '否', [...base, 'DebugInformation'], 'boolean'));
        items.push(editable('包含浏览信息', tco['BrowseInformation'] === '1' ? '是' : '否', [...base, 'BrowseInformation'], 'boolean'));
        items.push(editable('Listing 目录', tco['ListingPath'] || '', [...base, 'ListingPath']));
        items.push(editable('Hex 格式', tco['HexFormatSelection'] || '1', [...base, 'HexFormatSelection'], 'number'));
    }
    return items;
}

function getMemoryItems(targetDOM: any): SettingItem[] {
    const items: SettingItem[] = [];
    const isArm = targetDOM['ToolsetName'] && targetDOM['ToolsetName'].includes('ARM');

    if (isArm) {
        const ocmBase = ['TargetOption', 'TargetArmAds', 'ArmAdsMisc', 'OnChipMemories'];
        const ocm = getNested(targetDOM, ...ocmBase);
        if (ocm) {
            const iram = ocm['IRAM'];
            const irom = ocm['IROM'];
            if (iram) {
                items.push(editable('IRAM 起始地址', iram['StartAddress'] || '', [...ocmBase, 'IRAM', 'StartAddress']));
                items.push(editable('IRAM 大小', iram['Size'] || '', [...ocmBase, 'IRAM', 'Size']));
            }
            if (irom) {
                items.push(editable('IROM 起始地址', irom['StartAddress'] || '', [...ocmBase, 'IROM', 'StartAddress']));
                items.push(editable('IROM 大小', irom['Size'] || '', [...ocmBase, 'IROM', 'Size']));
            }
            const xram = ocm['XRAM'];
            if (xram) {
                items.push(editable('XRAM 起始地址', xram['StartAddress'] || '', [...ocmBase, 'XRAM', 'StartAddress']));
                items.push(editable('XRAM 大小', xram['Size'] || '', [...ocmBase, 'XRAM', 'Size']));
            }
        }
    }

    return items;
}

function getDebugItems(targetDOM: any): SettingItem[] {
    const items: SettingItem[] = [];
    const dllOption = getNested(targetDOM, 'TargetOption', 'DllOption');
    if (dllOption) {
        items.push(editable('模拟器 DLL', dllOption['SimDllName'] || '', ['TargetOption', 'DllOption', 'SimDllName']));
        items.push(editable('目标 DLL', dllOption['TargetDllName'] || '', ['TargetOption', 'DllOption', 'TargetDllName']));
        items.push(editable('调试对话框 DLL', dllOption['TargetDlgDll'] || '', ['TargetOption', 'DllOption', 'TargetDlgDll']));
    }

    const utils = getNested(targetDOM, 'TargetOption', 'Utilities');
    if (utils) {
        const flash1 = utils['Flash1'];
        if (flash1) {
            items.push(editable('使用目标驱动下载', flash1['UseTargetDll'] === '1' ? '是' : '否', ['TargetOption', 'Utilities', 'Flash1', 'UseTargetDll'], 'boolean'));
            items.push(editable('调试前更新 Flash', flash1['UpdateFlashBeforeDebugging'] === '1' ? '是' : '否', ['TargetOption', 'Utilities', 'Flash1', 'UpdateFlashBeforeDebugging'], 'boolean'));
        }
        items.push(editable('Flash 驱动 2', utils['Flash2'] || '', ['TargetOption', 'Utilities', 'Flash2']));
    }

    const tco = getNested(targetDOM, 'TargetOption', 'TargetCommonOption');
    if (tco) {
        items.push(editable('Flash 驱动', tco['FlashDriverDll'] || '', ['TargetOption', 'TargetCommonOption', 'FlashDriverDll']));
        items.push(editable('SVD 文件', tco['SFDFile'] || '', ['TargetOption', 'TargetCommonOption', 'SFDFile']));
    }

    // Build commands
    const bcb = ['TargetOption', 'TargetCommonOption', 'BeforeCompile'];
    const beforeCompile = getNested(targetDOM, ...bcb);
    if (beforeCompile) {
        items.push(editable('编译前命令 #1', beforeCompile['UserProg1Name'] || '', [...bcb, 'UserProg1Name']));
        items.push(editable('编译前命令 #2', beforeCompile['UserProg2Name'] || '', [...bcb, 'UserProg2Name']));
    }
    const amb = ['TargetOption', 'TargetCommonOption', 'AfterMake'];
    const afterMake = getNested(targetDOM, ...amb);
    if (afterMake) {
        items.push(editable('编译后命令 #1', afterMake['UserProg1Name'] || '', [...amb, 'UserProg1Name']));
        items.push(editable('编译后命令 #2', afterMake['UserProg2Name'] || '', [...amb, 'UserProg2Name']));
    }

    return items;
}

//============ 辅助函数 ============

/** 安全地获取嵌套属性 */
function getNested(obj: any, ...keys: string[]): any {
    let current = obj;
    for (const key of keys) {
        if (current === undefined || current === null) { return undefined; }
        current = current[key];
    }
    return current;
}

/** 提取文本内容（去掉 XML 属性等） */
function extractText(str: string): string {
    if (!str) { return ''; }
    // 提取括号外的核心信息，如 CPUTYPE("Cortex-M3") -> Cortex-M3
    const match = str.match(/"([^"]+)"/);
    return match ? match[1] : str;
}
