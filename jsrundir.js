"use strict";

/*************************************************************************************
* 
* MIT License
* 
* Copyright (c) 2021-2023 Pedro Garcia
* 
* Permission is hereby granted, free of charge, to any person obtaining a copy
* of this software and associated documentation files (the "Software"), to deal
* in the Software without restriction, including without limitation the rights
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
* copies of the Software, and to permit persons to whom the Software is
* furnished to do so, subject to the following conditions:
* 
* The above copyright notice and this permission notice shall be included in all
* copies or substantial portions of the Software.
* 
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
* SOFTWARE.
*
*************************************************************************************/

const fs = require('fs');
const path = require('path');
const __realname = path.resolve(__filename);

const log = (...args) => {
	if (require.main === module) {
		console.log(...args);
	}
}

const error = (...args) => {
	console.log(...args);
}

const RunWatcher = class {
	constructor(target, subdirs = false) {
		this.path = target;
		this.files = {};
		this.watcher = null;
		if (subdirs) this.directories = {};
	}

	checkFile(path, name) {
		return name[0] != '.' && (name.endsWith('.js') || name.endsWith('.json')) && (path !== __realname) && !this.files[name];
	}

	checkDirectory(path, name) {
		return name[0] != '.' && this.directories !== undefined && !this.directories[name];
	}

	fileInfo(path, name, stat) {
		return {
			path: path,
			name: name,
			isFile: stat ? stat.isFile() : false,
			isDirectory: stat ? stat.isDirectory() : false,
		};
	}

	fileAdded(info) {
		if (!this.checkFile(info.path, info.name)) return;

		this.files[info.name] = info;
		this.added(info);
	}

	fileRemoved(info) {
		delete this.files[info.name];
		this.removed(info);
	}

	directoryAdded(info) {
		if (!this.checkDirectory(info.path, info.name)) return;

		this.directories[info.name] = info;
		this.added(info);
	}

	directoryRemoved(info) {
		delete this.directories[info.name];
		this.removed(info);
	}

	watch(add, remove) {
		if (this.watcher) {
			throw new Error(`Already watching '${this.path}'`);
		}

		this.added = add;
		this.removed = remove;

		this.watcher = fs.watch(this.path + path.sep + '.', (event, file) => { // path.join would remove the trailing dot, which is needed do distinguish renames for /path/dir/. vs /path/dir/dir
			const target = path.join(this.path, file);

			log(`${target}: ${event}`); // change, rename (incl. create / delete)

			const stat = fs.statSync(target, { throwIfNoEntry: false });
			const info = this.fileInfo(target, file, stat);

			if (this.files[file]) {
				this.fileRemoved(this.files[file]);
			}
			else if (this.directories !== undefined && this.directories[file] && !info.isDirectory) {
				this.directoryRemoved(this.directories[file]);
			}

			if (info.isFile) {
				this.fileAdded(info);
			}
			else if (info.isDirectory) {
				this.directoryAdded(info);
			}
		});

		const files = fs.readdirSync(this.path).sort().map((file) => {
			const sub = path.join(this.path, file);
			return this.fileInfo(sub, file, fs.statSync(sub, { throwIfNoEntry: false }));
		});

		for (const info of files) {
			if (info.isFile) this.fileAdded(info);
		}

		for (const info of files) {
			if (info.isDirectory) this.directoryAdded(info);
		}
	}

	stop() {
		if (!this.watcher) {
			throw new Error(`Not watching '${this.path}'`);
		}

		this.watcher.close();
		this.watcher = null;
	
		if (this.directories !== undefined) {
			for (const dir of Object.keys(this.directories).sort().reverse()) {
				this.directoryRemoved(this.directories[dir]);
			}
		}

		for (const file of Object.keys(this.files).sort().reverse()) {
			this.fileRemoved(this.files[file]);
		}
	}
}

module.exports = class {
	#targets = [];
	#watchers = {};
	#queue = [];
	#handlers = {
		load: [],
		unload: [],
	};

	constructor(targets) {
		(Array.isArray(targets) ? targets : [ targets ]).forEach((target) => {
			this.add(target);
		});
	}

	#notify(event, ...args) {
		// TO DO: debounce
	
		return new Promise((resolve) => {
			this.#queue.push(resolve);
			if (this.#queue.length == 1) resolve();
		}).then(() => {
			const handlers = typeof event === "function" ? [ event ] : this.#handlers[event];
			if (!handlers) return;

			const batch = handlers.map((handler) => new Promise((resolve, reject) => {
				try {
					resolve(handler(...args));
				}
				catch (e) {
					reject(e);
				}
			}).catch((e) => {
				error(e);
			}));

			return Promise.all(batch);
		}).then(() => {
			this.#queue.shift();
			if (this.#queue.length) this.#queue[0]();
		});
        }

	add(target) {
		target = path.resolve(target);

		if (!fs.lstatSync(target).isDirectory()) {
			throw new Error(`Not a directory: ${target}`);
		}

		if (this.#watchers[target]) {
			throw new Error(`Already watching: ${target}`);
		}

		this.#targets.push(target);
		this.#watchers[target] = new RunWatcher(target, true);

		return this;
	}

	#run(target) {
		const watcher = this.#watchers[target];

		if (!watcher || watcher.directories === undefined) {
			throw new Error(`Unknown target: ${target}`);
		}

		const remover = (remove) => {
			if (remove.isFile) {
				log(`Unloading file: ${remove.path}`);

				const loaded = require.cache[remove.path];

				if (loaded) {
					delete require.cache[remove.path];

					this.#notify('unload', remove.path, loaded.exports);

					if (typeof loaded.exports.jsrundir === "object" && typeof loaded.exports.jsrundir.onUnload === "function") {
						this.#notify(loaded.exports.jsrundir.onUnload);
					}
				}

			}
			else if (remove.isDirectory) {
				log(`Unloading directory: ${remove.path}`);

				const watcher = this.#watchers[remove.path];

				watcher.stop();
				
				if (watcher.directories === undefined) delete this.#watchers[remove.path];
			}
		}

		const adder = (add) => {
			if (add.isFile) {
				log(`Loading file: ${add.path}`);

				try {
					const loaded = require(add.path);

					if (loaded && typeof loaded.jsrundir === "object" && typeof loaded.jsrundir.onLoad === "function") {
						this.#notify(loaded.jsrundir.onLoad);
					}

					this.#notify('load', add.path, loaded);
				}
				catch (e) {
					error(e);
				}

			}
			else if (add.isDirectory && !this.#watchers[add.path]) {
				log(`Loading directory: ${add.path}`);

				const watcher = new RunWatcher(add.path);

				this.#watchers[add.path] = watcher;

				watcher.watch(adder, remover);
			}
		};

		watcher.watch(adder, remover);
	}

	run() {
		for (const target of this.#targets) {
			this.#run(target);
		}
	}

	#stop(target) {
		const watcher = this.#watchers[target];

		if (!watcher || watcher.directories === undefined) {
			throw new Error(`Unknown target: ${target}`);
		}

		watcher.stop();
	}

	stop() {
		for (const target of this.#targets.reverse()) {
			this.#stop(target);
		}
	}

	on(event, handler) {
		if (this.#handlers[event]) this.#handlers[event].push(handler);
	}
};

if (require.main === module) {
	const process = require('process');
	const targets = process.argv.slice(2);
	const watcher = new module.exports(targets.length ? targets : __dirname);

	const shutdown = () => {
		watcher.stop();
		// process.exit(0);
	};

	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);

	watcher.run();
}
