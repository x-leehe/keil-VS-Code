import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/** 函数定义 */
export interface FuncDef {
    name: string;
    filePath: string;
    line: number;
    signature: string;
}

/** C/C++ 函数正则：匹配 返回类型 函数名( 的模式 */
const FUNC_PATTERN = /^(?:\/\*\*[\s\S]*?\*\/\s*)?(?:static\s+)?(?:inline\s+)?(?:__attribute__\s*\(\([^)]*\)\)\s*)?(?:void|int|char|float|double|long|short|unsigned|signed|bool|uint\w*_t|int\w*_t|size_t|ssize_t|volatile\s+\w+|\w+\s*\*?\s*)\s+(\w+)\s*\(/gm;

/**
 * 扫描指定目录下所有 C/C++ 源文件的函数定义
 */
export function scanDirectory(dirPath: string): FuncDef[] {
    const results: FuncDef[] = [];
    const extensions = ['.c', '.h', '.cpp', '.hpp', '.s', '.S', '.inc'];
    scanRecursive(dirPath, extensions, results);
    return results;
}

function scanRecursive(dir: string, extensions: string[], results: FuncDef[]): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            // 跳过隐藏目录、.vscode、Objects、Listings 等
            if (!entry.name.startsWith('.') && !['Objects', 'Listings', 'Output'].includes(entry.name)) {
                scanRecursive(fullPath, extensions, results);
            }
        } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (extensions.includes(ext)) {
                scanFile(fullPath, results);
            }
        }
    }
}

function scanFile(filePath: string, results: FuncDef[]): void {
    let content: string;
    try {
        content = fs.readFileSync(filePath, 'utf-8');
    } catch {
        return;
    }

    const lines = content.split('\n');
    FUNC_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = FUNC_PATTERN.exec(content)) !== null) {
        const funcName = match[1];
        if (!funcName || isKeyword(funcName)) { continue; }

        const pos = match.index;
        const line = content.substring(0, pos).split('\n').length;
        const sig = (lines[line - 1] || match[0]).trim();

        results.push({ name: funcName, filePath, line, signature: sig });
    }
}

function isKeyword(name: string): boolean {
    const keywords = ['if', 'else', 'while', 'for', 'switch', 'case', 'return', 'sizeof', 'typeof'];
    return keywords.includes(name);
}
