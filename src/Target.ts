import * as vscode from 'vscode';
import * as node_path from 'path';
import * as event from 'events';
import * as child_process from 'child_process';
import { File } from '../lib/node_utility/File';
import { FileWatcher } from '../lib/node_utility/FileWatcher';
import { CmdLineHandler } from './CmdLineHandler';
import { ResourceManager } from './ResourceManager';
import { IView, Source, FileGroup, KeilProjectInfo, uVisonInfo } from './models';
import { t } from './i18n';

// ==============================================
// Target 抽象基类 + C51 / ARM 具体实现
// ==============================================

export abstract class Target implements IView {
    prjID: string;
    label: string;
    tooltip?: string | undefined;
    contextVal?: string | undefined = 'Target';
    icons?: undefined;

    readonly targetName: string;

    protected _event: event.EventEmitter;
    protected project: KeilProjectInfo;
    protected cppConfigName: string;
    protected targetDOM: any;
    protected uvInfo: uVisonInfo;
    protected fGroups: FileGroup[];
    protected includes: Set<string>;
    protected defines: Set<string>;

    private uv4LogFile: File;
    private uv4LogLockFileWatcher: FileWatcher;

    constructor(prjInfo: KeilProjectInfo, uvInfo: uVisonInfo, targetDOM: any) {
        this._event = new event.EventEmitter();
        this.project = prjInfo;
        this.targetDOM = targetDOM;
        this.uvInfo = uvInfo;
        this.prjID = prjInfo.prjID;
        this.targetName = targetDOM['TargetName'];
        this.label = this.targetName;
        this.tooltip = this.targetName;
        this.cppConfigName = this.targetName;
        this.includes = new Set<string>();
        this.defines = new Set<string>();
        this.fGroups = [];

        this.uv4LogFile = new File(this.project.vscodeDir.path + File.sep + 'uv4.log');
        this.uv4LogLockFileWatcher = new FileWatcher(new File(this.uv4LogFile.path + '.lock'));
        if (!this.uv4LogLockFileWatcher.file.IsFile()) {
            this.uv4LogLockFileWatcher.file.Write('');
        }
        this.uv4LogLockFileWatcher.Watch();
        this.uv4LogLockFileWatcher.OnChanged = () => this.updateSourceRefs();
        this.uv4LogLockFileWatcher.on('error', () => {
            this.uv4LogLockFileWatcher.Close();
            if (!this.uv4LogLockFileWatcher.file.IsFile()) {
                this.uv4LogLockFileWatcher.file.Write('');
            }
            this.uv4LogLockFileWatcher.Watch();
        });
    }

    on(event: 'dataChanged', listener: () => void): void;
    on(event: any, listener: () => void): void {
        this._event.on(event, listener);
    }

    static getInstance(prjInfo: KeilProjectInfo, uvInfo: uVisonInfo, targetDOM: any): Target {
        if (prjInfo.uvprjFile.suffix.toLowerCase() === '.uvproj') {
            return new C51Target(prjInfo, uvInfo, targetDOM);
        } else {
            return new ArmTarget(prjInfo, uvInfo, targetDOM);
        }
    }

    protected getDefCppProperties() {
        return {
            configurations: [
                {
                    name: this.cppConfigName,
                    includePath: undefined as string[] | undefined,
                    defines: undefined as string[] | undefined,
                    intelliSenseMode: '${default}'
                }
            ],
            version: 4
        };
    }

    updateCppProperties(): void {
        const proFile = new File(this.project.vscodeDir.path + File.sep + 'c_cpp_properties.json');
        let obj: any;
        if (proFile.IsFile()) {
            try {
                obj = JSON.parse(proFile.Read());
            } catch (error) {
                this.project.logger.log(error);
                obj = this.getDefCppProperties();
            }
        } else {
            obj = this.getDefCppProperties();
        }

        const configList = obj['configurations'];
        const index = configList.findIndex((conf: any) => { return conf.name === this.cppConfigName; });
        if (index === -1) {
            configList.push({
                name: this.cppConfigName,
                includePath: Array.from(this.includes).concat(['${default}']),
                defines: Array.from(this.defines),
                intelliSenseMode: '${default}'
            });
        } else {
            configList[index]['includePath'] = Array.from(this.includes).concat(['${default}']);
            configList[index]['defines'] = Array.from(this.defines);
        }
        proFile.Write(JSON.stringify(obj, undefined, 4));
    }

    async load(): Promise<void> {
        const err = this.checkProject(this.targetDOM);
        if (err) {
            throw err;
        }

        const incListStr = this.getIncString(this.targetDOM);
        const defineListStr = this.getDefineString(this.targetDOM);
        const _groups = this.getGroups(this.targetDOM);
        const sysIncludes = this.getSystemIncludes(this.targetDOM);

        this.includes.clear();
        let incList = incListStr.split(';');
        if (sysIncludes) {
            incList = incList.concat(sysIncludes);
        }
        incList.forEach((path: string) => {
            const realPath = path.trim();
            if (realPath !== '') {
                this.includes.add(this.project.toAbsolutePath(realPath));
            }
        });

        this.defines.clear();
        defineListStr.split(/,|\s+/).forEach((define: string) => {
            if (define.trim() !== '') {
                this.defines.add(define);
            }
        });
        this.getSysDefines(this.targetDOM).forEach((define: string) => {
            this.defines.add(define);
        });

        this.fGroups = [];
        let groups: any[];
        if (Array.isArray(_groups)) {
            groups = _groups;
        } else {
            groups = [_groups];
        }

        for (const group of groups) {
            if (group['Files'] !== undefined) {
                let isGroupExcluded = false;
                let fileList: any[];

                if (group['GroupOption']) {
                    const gOption = group['GroupOption']['CommonProperty'];
                    if (gOption && gOption['IncludeInBuild'] === '0') {
                        isGroupExcluded = true;
                    }
                }

                const nGrp = new FileGroup(this.prjID, group['GroupName'], isGroupExcluded);

                if (Array.isArray(group['Files'])) {
                    fileList = [];
                    for (const files of group['Files']) {
                        if (Array.isArray(files['File'])) {
                            fileList = fileList.concat(files['File']);
                        } else if (files['File'] !== undefined) {
                            fileList.push(files['File']);
                        }
                    }
                } else {
                    if (Array.isArray(group['Files']['File'])) {
                        fileList = group['Files']['File'];
                    } else if (group['Files']['File'] !== undefined) {
                        fileList = [group['Files']['File']];
                    } else {
                        fileList = [];
                    }
                }

                for (const file of fileList) {
                    const f = new File(this.project.toAbsolutePath(file['FilePath']));
                    let isFileExcluded = isGroupExcluded;
                    if (isFileExcluded === false && file['FileOption']) {
                        const fOption = file['FileOption']['CommonProperty'];
                        if (fOption && fOption['IncludeInBuild'] === '0') {
                            isFileExcluded = true;
                        }
                    }
                    const nFile = new Source(this.prjID, f, !isFileExcluded);
                    this.includes.add(f.dir);
                    nGrp.sources.push(nFile);
                }
                this.fGroups.push(nGrp);
            }
        }

        this.updateCppProperties();
        this.updateSourceRefs();
    }

    protected quoteString(str: string, quote: string = '"'): string {
        return str.includes(' ') ? (quote + str + quote) : str;
    }

    runTask(name: string, commands: string[]): void {
        const resManager = ResourceManager.getInstance();
        let args: string[] = [];
        args.push('-o', this.uv4LogFile.path);
        args = args.concat(commands);

        const isCmd = /cmd.exe$/i.test(process.env.ComSpec || 'cmd.exe');
        const quote = isCmd ? '"' : '\'';
        const invokePrefix = isCmd ? '' : '& ';
        const cmdPrefixSuffix = isCmd ? '"' : '';

        let commandLine = invokePrefix + this.quoteString(resManager.getBuilderExe(), quote) + ' ';
        commandLine += args.map((arg: string) => { return this.quoteString(arg, quote); }).join(' ');

        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const task = new vscode.Task(
                { type: 'keil-task' },
                vscode.TaskScope.Global,
                name,
                'shell'
            );
            task.execution = new vscode.ShellExecution(cmdPrefixSuffix + commandLine + cmdPrefixSuffix);
            task.isBackground = false;
            task.problemMatchers = this.getProblemMatcher();
            task.presentationOptions = {
                echo: false,
                focus: false,
                clear: true
            };
            vscode.tasks.executeTask(task);
        } else {
            const index = vscode.window.terminals.findIndex((ter: vscode.Terminal) => {
                return ter.name === name;
            });
            if (index !== -1) {
                vscode.window.terminals[index].hide();
                vscode.window.terminals[index].dispose();
            }
            const terminal = vscode.window.createTerminal(name);
            terminal.show();
            terminal.sendText(commandLine);
        }
    }

    build(): void {
        this.runTask('build', this.getBuildCommand());
    }

    rebuild(): void {
        this.runTask('rebuild', this.getRebuildCommand());
    }

    download(): void {
        this.runTask('download', this.getDownloadCommand());
    }

    updateSourceRefs(): void {
        const rePath = this.getOutputFolder(this.targetDOM);
        if (rePath) {
            const outPath = this.project.toAbsolutePath(rePath);
            this.fGroups.forEach((group: FileGroup) => {
                group.sources.forEach((source: Source) => {
                    if (source.enable) {
                        const refFile = File.fromArray([outPath, source.file.noSuffixName + '.d']);
                        if (refFile.IsFile()) {
                            const refFileList = this.parseRefLines(
                                this.targetDOM,
                                refFile.Read().split(/\r\n|\n/)
                            ).map((rePath: string) => { return this.project.toAbsolutePath(rePath); });
                            source.children = refFileList.map((refFilePath: string) => {
                                return new Source(source.prjID, new File(refFilePath));
                            });
                        }
                    }
                });
            });
            this._event.emit('dataChanged');
        }
    }

    close(): void {
        this.uv4LogLockFileWatcher.Close();
    }

    getChildViews(): IView[] | undefined {
        return this.fGroups;
    }

    // ====== 抽象方法 —— 子类必须实现 ======
    protected abstract checkProject(target: any): Error | undefined;
    protected abstract parseRefLines(target: any, lines: string[]): string[];
    protected abstract getOutputFolder(target: any): string | undefined;
    abstract getSysDefines(target: any): string[];
    protected abstract getSystemIncludes(target: any): string[] | undefined;
    protected abstract getIncString(target: any): string;
    protected abstract getDefineString(target: any): string;
    protected abstract getGroups(target: any): any;
    abstract getProblemMatcher(): string[];
    abstract getBuildCommand(): string[];
    abstract getRebuildCommand(): string[];
    abstract getDownloadCommand(): string[];
}

// ==============================================
// C51 Target
// ==============================================

export class C51Target extends Target {
    protected checkProject(target: any): Error | undefined {
        if (target['TargetOption']['Target51'] === undefined ||
            target['TargetOption']['Target51']['C51'] === undefined) {
            return new Error(t('target.notC51'));
        }
        return undefined;
    }

    protected parseRefLines(_target: any, _lines: string[]): string[] {
        return [];
    }

    protected getOutputFolder(_target: any): string | undefined {
        return undefined;
    }

    getSysDefines(_target: any): string[] {
        return [
            '__C51__',
            '__VSCODE_C51__',
            'reentrant=',
            'compact=',
            'small=',
            'large=',
            'data=',
            'idata=',
            'pdata=',
            'bdata=',
            'xdata=',
            'code=',
            'bit=char',
            'sbit=char',
            'sfr=char',
            'sfr16=int',
            'sfr32=int',
            'interrupt=',
            'using=',
            '_at_=',
            '_priority_=',
            '_task_='
        ];
    }

    protected getSystemIncludes(_target: any): string[] | undefined {
        const exeFile = new File(ResourceManager.getInstance().getC51UV4Path());
        if (exeFile.IsFile()) {
            return [
                node_path.dirname(exeFile.dir) + File.sep + 'C51' + File.sep + 'INC'
            ];
        }
        return undefined;
    }

    protected getIncString(target: any): string {
        const target51 = target['TargetOption']['Target51']['C51'];
        return target51['VariousControls']['IncludePath'];
    }

    protected getDefineString(target: any): string {
        const target51 = target['TargetOption']['Target51']['C51'];
        return target51['VariousControls']['Define'];
    }

    protected getGroups(target: any): any {
        return target['Groups']['Group'] || [];
    }

    getProblemMatcher(): string[] {
        return ['$c51'];
    }

    getBuildCommand(): string[] {
        return [
            '--uv4Path', ResourceManager.getInstance().getC51UV4Path(),
            '--prjPath', this.project.uvprjFile.path,
            '--targetName', this.targetName,
            '-c', '${uv4Path} -b ${prjPath} -j0 -t ${targetName}'
        ];
    }

    getRebuildCommand(): string[] {
        return [
            '--uv4Path', ResourceManager.getInstance().getC51UV4Path(),
            '--prjPath', this.project.uvprjFile.path,
            '--targetName', this.targetName,
            '-c', '${uv4Path} -r ${prjPath} -j0 -t ${targetName}'
        ];
    }

    getDownloadCommand(): string[] {
        return [
            '--uv4Path', ResourceManager.getInstance().getC51UV4Path(),
            '--prjPath', this.project.uvprjFile.path,
            '--targetName', this.targetName,
            '-c', '${uv4Path} -f ${prjPath} -j0 -t ${targetName}'
        ];
    }
}

// ==============================================
// Macro 处理器（ARMClang 内置宏解析）
// ==============================================

export class MacroHandler {
    private regMatchers: { [key: string]: RegExp } = {
        'normal_macro': /^#define (\w+) (.*)$/,
        'func_macro': /^#define (\w+\([^)]*\)) (.*)$/
    };

    toExpression(macro: string): string | undefined {
        let mList = this.regMatchers['normal_macro'].exec(macro);
        if (mList && mList.length > 2) {
            return `${mList[1]}=${mList[2]}`;
        }
        mList = this.regMatchers['func_macro'].exec(macro);
        if (mList && mList.length > 2) {
            return `${mList[1]}=`;
        }
        return undefined;
    }
}

// ==============================================
// ARM Target（ARMCC / ARMClang）
// ==============================================

export class ArmTarget extends Target {
    static armccMacros: string[] = [
        '__CC_ARM',
        '__arm__',
        '__align(x)=',
        '__ALIGNOF__(x)=',
        '__alignof__(x)=',
        '__asm(x)=',
        '__forceinline=',
        '__restrict=',
        '__global_reg(n)=',
        '__inline=',
        '__int64=long long',
        '__INTADDR__(expr)=0',
        '__irq=',
        '__packed=',
        '__pure=',
        '__smc(n)=',
        '__svc(n)=',
        '__svc_indirect(n)=',
        '__svc_indirect_r7(n)=',
        '__value_in_regs=',
        '__weak=',
        '__writeonly=',
        '__declspec(x)=',
        '__attribute__(x)=',
        '__nonnull__(x)=',
        '__register=',
        '__breakpoint(x)=',
        '__cdp(x,y,z)=',
        '__clrex()=',
        '__clz(x)=0U',
        '__current_pc()=0U',
        '__current_sp()=0U',
        '__disable_fiq()=',
        '__disable_irq()=',
        '__dmb(x)=',
        '__dsb(x)=',
        '__enable_fiq()=',
        '__enable_irq()=',
        '__fabs(x)=0.0',
        '__fabsf(x)=0.0f',
        '__force_loads()=',
        '__force_stores()=',
        '__isb(x)=',
        '__ldrex(x)=0U',
        '__ldrexd(x)=0U',
        '__ldrt(x)=0U',
        '__memory_changed()=',
        '__nop()=',
        '__pld(...)=',
        '__pli(...)=',
        '__qadd(x,y)=0',
        '__qdbl(x)=0',
        '__qsub(x,y)=0',
        '__rbit(x)=0U',
        '__rev(x)=0U',
        '__return_address()=0U',
        '__ror(x,y)=0U',
        '__schedule_barrier()=',
        '__semihost(x,y)=0',
        '__sev()=',
        '__sqrt(x)=0.0',
        '__sqrtf(x)=0.0f',
        '__ssat(x,y)=0',
        '__strex(x,y)=0U',
        '__strexd(x,y)=0',
        '__strt(x,y)=',
        '__swp(x,y)=0U',
        '__usat(x,y)=0U',
        '__wfe()=',
        '__wfi()=',
        '__yield()=',
        '__vfp_status(x,y)=0'
    ];

    static armclangMacros: string[] = [
        '__alignof__(x)=',
        '__asm(x)=',
        '__asm__(x)=',
        '__forceinline=',
        '__restrict=',
        '__volatile__=',
        '__inline=',
        '__inline__=',
        '__declspec(x)=',
        '__attribute__(x)=',
        '__nonnull__(x)=',
        '__unaligned=',
        '__promise(x)=',
        '__irq=',
        '__swi=',
        '__weak=',
        '__register=',
        '__pure=',
        '__value_in_regs=',
        '__breakpoint(x)=',
        '__current_pc()=0U',
        '__current_sp()=0U',
        '__disable_fiq()=',
        '__disable_irq()=',
        '__enable_fiq()=',
        '__enable_irq()=',
        '__force_stores()=',
        '__memory_changed()=',
        '__schedule_barrier()=',
        '__semihost(x,y)=0',
        '__vfp_status(x,y)=0',
        '__builtin_arm_nop()=',
        '__builtin_arm_wfi()=',
        '__builtin_arm_wfe()=',
        '__builtin_arm_sev()=',
        '__builtin_arm_sevl()=',
        '__builtin_arm_yield()=',
        '__builtin_arm_isb(x)=',
        '__builtin_arm_dsb(x)=',
        '__builtin_arm_dmb(x)=',
        '__builtin_bswap32(x)=0U',
        '__builtin_bswap16(x)=0U',
        '__builtin_arm_rbit(x)=0U',
        '__builtin_clz(x)=0U',
        '__builtin_arm_ldrex(x)=0U',
        '__builtin_arm_strex(x,y)=0U',
        '__builtin_arm_clrex()=',
        '__builtin_arm_ssat(x,y)=0U',
        '__builtin_arm_usat(x,y)=0U',
        '__builtin_arm_ldaex(x)=0U',
        '__builtin_arm_stlex(x,y)=0U'
    ];

    static armclangBuildinMacros: string[] | undefined;

    constructor(prjInfo: KeilProjectInfo, uvInfo: uVisonInfo, targetDOM: any) {
        super(prjInfo, uvInfo, targetDOM);
        ArmTarget.initArmclangMacros();
    }

    protected checkProject(): Error | undefined {
        return undefined;
    }

    protected getOutputFolder(target: any): string | undefined {
        try {
            return target['TargetOption']['TargetCommonOption']['OutputDirectory'];
        } catch (_error) {
            return undefined;
        }
    }

    private gnu_parseRefLines(lines: string[]): string[] {
        const resultList = new Set<string>();
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const _line = lines[lineIndex];
            const line = _line[_line.length - 1] === '\\' ? _line.substring(0, _line.length - 1) : _line;
            const subLines = line.trim().split(/(?<![\\:]) /);
            if (lineIndex === 0) {
                for (let i = 1; i < subLines.length; i++) {
                    resultList.add(subLines[i].trim().replace(/\\ /g, " "));
                }
            } else {
                subLines.forEach((item: string) => {
                    resultList.add(item.trim().replace(/\\ /g, " "));
                });
            }
        }
        return Array.from(resultList);
    }

    private ac5_parseRefLines(lines: string[], startIndex: number = 1): string[] {
        const resultList = new Set<string>();
        for (let i = startIndex; i < lines.length; i++) {
            const sepIndex = lines[i].indexOf(": ");
            if (sepIndex > 0) {
                const line = lines[i].substring(sepIndex + 1).trim();
                resultList.add(line);
            }
        }
        return Array.from(resultList);
    }

    protected parseRefLines(target: any, lines: string[]): string[] {
        if (target['uAC6'] === '1') {
            return this.gnu_parseRefLines(lines);
        } else {
            return this.ac5_parseRefLines(lines);
        }
    }

    static initArmclangMacros(): void {
        if (ArmTarget.armclangBuildinMacros === undefined) {
            const armClangPath = node_path.dirname(node_path.dirname(ResourceManager.getInstance().getArmUV4Path()))
                + File.sep + 'ARM' + File.sep + 'ARMCLANG' + File.sep + 'bin' + File.sep + 'armclang.exe';
            ArmTarget.armclangBuildinMacros = ArmTarget.getArmClangMacroList(armClangPath);
        }
    }

    getSysDefines(target: any): string[] {
        if (target['uAC6'] === '1') {
            return ArmTarget.armclangMacros.concat(ArmTarget.armclangBuildinMacros || []);
        } else {
            return ArmTarget.armccMacros;
        }
    }

    static getArmClangMacroList(armClangPath: string): string[] {
        try {
            const cmdLine = CmdLineHandler.quoteString(armClangPath, '"')
                + ' ' + ['--target=arm-arm-none-eabi', '-E', '-dM', '-', '<nul'].join(' ');
            const lines = child_process.execSync(cmdLine).toString().split(/\r\n|\n/);
            const resList: string[] = [];
            const mHandler = new MacroHandler();
            lines.filter((line: string) => { return line.trim() !== ''; })
                .forEach((line: string) => {
                    const value = mHandler.toExpression(line);
                    if (value) {
                        resList.push(value);
                    }
                });
            return resList;
        } catch (_error) {
            return ['__GNUC__=4', '__GNUC_MINOR__=2', '__GNUC_PATCHLEVEL__=1'];
        }
    }

    protected getSystemIncludes(target: any): string[] | undefined {
        const exeFile = new File(ResourceManager.getInstance().getArmUV4Path());
        if (exeFile.IsFile()) {
            const toolName = target['uAC6'] === '1' ? 'ARMCLANG' : 'ARMCC';
            const incDir = new File(`${node_path.dirname(exeFile.dir)}${File.sep}ARM${File.sep}${toolName}${File.sep}include`);
            if (incDir.IsDir()) {
                return [incDir.path].concat(incDir.GetList(File.EMPTY_FILTER).map((dir: File) => { return dir.path; }));
            }
            return [incDir.path];
        }
        return undefined;
    }

    protected getIncString(target: any): string {
        const dat = target['TargetOption']['TargetArmAds']['Cads'];
        return dat['VariousControls']['IncludePath'];
    }

    protected getDefineString(target: any): string {
        const dat = target['TargetOption']['TargetArmAds']['Cads'];
        return dat['VariousControls']['Define'];
    }

    protected getGroups(target: any): any {
        return target['Groups']['Group'] || [];
    }

    getProblemMatcher(): string[] {
        return ['$armcc', '$gcc'];
    }

    getBuildCommand(): string[] {
        return [
            '--uv4Path', ResourceManager.getInstance().getArmUV4Path(),
            '--prjPath', this.project.uvprjFile.path,
            '--targetName', this.targetName,
            '-c', '${uv4Path} -b ${prjPath} -j0 -t ${targetName}'
        ];
    }

    getRebuildCommand(): string[] {
        return [
            '--uv4Path', ResourceManager.getInstance().getArmUV4Path(),
            '--prjPath', this.project.uvprjFile.path,
            '--targetName', this.targetName,
            '-c', '${uv4Path} -r ${prjPath} -j0 -t ${targetName}'
        ];
    }

    getDownloadCommand(): string[] {
        return [
            '--uv4Path', ResourceManager.getInstance().getArmUV4Path(),
            '--prjPath', this.project.uvprjFile.path,
            '--targetName', this.targetName,
            '-c', '${uv4Path} -f ${prjPath} -j0 -t ${targetName}'
        ];
    }
}
