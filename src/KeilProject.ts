import * as vscode from 'vscode';
import * as fs from 'fs';
import * as node_path from 'path';
import * as crypto from 'crypto';
import * as event from 'events';
import * as xml2js from 'xml2js';
import { File } from '../lib/node_utility/File';
import { FileWatcher } from '../lib/node_utility/FileWatcher';
import { Time } from '../lib/node_utility/Time';
import { IView, KeilProjectInfo, uVisonInfo } from './models';
import { Target } from './Target';

// ==============================================
// KeilProject — 单个 Keil 工程的数据模型
// ==============================================

function getMD5(data: string): string {
    const md5 = crypto.createHash('md5');
    md5.update(data);
    return md5.digest('hex');
}

export class KeilProject implements IView, KeilProjectInfo {

    prjID: string;
    label: string;
    tooltip?: string | undefined;
    contextVal?: string | undefined = 'Project';
    icons?: { light: string; dark: string } = {
        light: 'DeactiveApplication_16x',
        dark: 'DeactiveApplication_16x'
    };

    vscodeDir: File;
    uvprjFile: File;
    logger: Console;

    uVsionFileInfo: uVisonInfo;

    private activeTargetName: string | undefined;
    private prevUpdateTime: number | undefined;

    protected _event: event.EventEmitter;
    protected watcher: FileWatcher;
    protected targetList: Target[];

    constructor(_uvprjFile: File) {
        this._event = new event.EventEmitter();
        this.uVsionFileInfo = <uVisonInfo>{};
        this.targetList = [];
        this.vscodeDir = new File(_uvprjFile.dir + File.sep + '.vscode');
        this.vscodeDir.CreateDir();
        const logPath = this.vscodeDir.path + File.sep + 'keil-assistant.log';
        this.logger = new console.Console(fs.createWriteStream(logPath, { flags: 'a+' }));
        this.uvprjFile = _uvprjFile;
        this.watcher = new FileWatcher(this.uvprjFile);
        this.prjID = getMD5(_uvprjFile.path);
        this.label = _uvprjFile.noSuffixName;
        this.tooltip = _uvprjFile.path;
        this.logger.log('[info] Log at : ' + Time.GetInstance().GetTimeStamp() + '\r\n');
        this.watcher.OnChanged = () => {
            if (this.prevUpdateTime === undefined ||
                this.prevUpdateTime + 2000 < Date.now()) {
                this.prevUpdateTime = Date.now();
                setTimeout(() => this.onReload(), 300);
            }
        };
        this.watcher.Watch();
    }

    on(event: 'dataChanged', listener: () => void): void;
    on(event: any, listener: () => void): void {
        this._event.on(event, listener);
    }

    async onReload(): Promise<void> {
        try {
            this.targetList.forEach((target) => target.close());
            this.targetList = [];
            await this.load();
            this.notifyUpdateView();
        } catch (err) {
            const error = err as NodeJS.ErrnoException;
            if (error.code && error.code === 'EBUSY') {
                this.logger.log(`[Warn] uVision project file '${this.uvprjFile.name}' is locked !, delay 500 ms and retry !`);
                setTimeout(() => this.onReload(), 500);
            } else {
                vscode.window.showErrorMessage(`reload project failed !, msg: ${error.message}`);
            }
        }
    }

    async load(): Promise<void> {
        const parser = new xml2js.Parser({ explicitArray: false });
        const doc = await parser.parseStringPromise({ toString: () => { return this.uvprjFile.Read(); } });
        const targets = doc['Project']['Targets']['Target'];

        this.uVsionFileInfo.schemaVersion = doc['Project']['SchemaVersion'];

        if (Array.isArray(targets)) {
            for (const target of targets) {
                this.targetList.push(Target.getInstance(this, this.uVsionFileInfo, target));
            }
        } else {
            this.targetList.push(Target.getInstance(this, this.uVsionFileInfo, targets));
        }

        for (const target of this.targetList) {
            await target.load();
            target.on('dataChanged', () => this.notifyUpdateView());
        }
    }

    notifyUpdateView(): void {
        this._event.emit('dataChanged');
    }

    close(): void {
        this.watcher.Close();
        this.targetList.forEach((target) => target.close());
        this.logger.log('[info] project closed: ' + this.label);
    }

    toAbsolutePath(rePath: string): string {
        const path = rePath.replace(/\//g, File.sep);
        if (/^[a-z]:/i.test(path)) {
            return node_path.normalize(path);
        }
        return node_path.normalize(this.uvprjFile.dir + File.sep + path);
    }

    active(): void {
        this.icons = { light: 'ActiveApplication_16x', dark: 'ActiveApplication_16x' };
    }

    deactive(): void {
        this.icons = { light: 'DeactiveApplication_16x', dark: 'DeactiveApplication_16x' };
    }

    getTargetByName(name: string): Target | undefined {
        const index = this.targetList.findIndex((t) => { return t.targetName === name; });
        if (index !== -1) {
            return this.targetList[index];
        }
    }

    setActiveTarget(tName: string): void {
        if (tName !== this.activeTargetName) {
            this.activeTargetName = tName;
            this.notifyUpdateView();
        }
    }

    getActiveTarget(): Target | undefined {
        if (this.activeTargetName) {
            return this.getTargetByName(this.activeTargetName);
        } else if (this.targetList.length > 0) {
            return this.targetList[0];
        }
    }

    getChildViews(): IView[] | undefined {
        if (this.activeTargetName) {
            const target = this.getTargetByName(this.activeTargetName);
            if (target) {
                return [target];
            }
        }
        if (this.targetList.length > 0) {
            return [this.targetList[0]];
        }
        return undefined;
    }

    getTargets(): Target[] {
        return this.targetList;
    }
}
