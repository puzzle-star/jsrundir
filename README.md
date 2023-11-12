# jsrundir
NodeJS package to run and automatically reload all scripts in a _**directory**_ and _**first level subdirectories**_.

This package has no dependencies, and uses the nodejs fs.watch API. Currently tested only under Linux, but will extend to Windows as testing progresses.

## Command line invokation

> nodejs jsrundir.js _**[directories ...]**_

This will watch for all _**'*.js'**_ and _**'*.json'**_ files in the directories provided as argument list, and (re)import them wvery time they are added or changed. If no argument list is provided it will watch for files in the same directory as _**jsrundir.js**_ file is located (in case it is used as a standalone file instead of a package).

## API (import from other package)

```javascript
if (require.main === module) {
  const path = require('path');
  const process = require('process');
  const parameters = process.argv.slice(2);
  if (parameters.length != 1) process.exit(1);

  // JSRunDir initialization ---------------------------------------------
  const RunDir = new require('jsrundir');
  const rundir = new RunDir(path.resolve(parameters[0]));
  rundir.on('load', (name, module) => console.log(`loaded: ${name}`));
  rundir.on('unload', (name, module) => console.log(`unloaded: ${name}`));
  // ---------------------------------------------------------------------

  const shutdown = () => {
    // Stop JSRunDir instance
    rundir.stop();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (error) => console.log(error));

  try {
    // Start JSRunDir instance (this will start watching and dynamic (re)loading
    rundir.run();
  }
  catch (e) {
    console.log(e);
    shutdown();
  }
}
```

## Events

> **load:** will be called every time a script file is added, with the _**loaded script name**_ as first parameter, and the _**loaded module**_ as second parameter.

> **unload:** will be called every time a script file is removed with the _**unloaded script name**_ as first parameter, and the _**unloaded module**_ as second parameter.

When a script file is **modified**, an **unload** event will be triggered, followed by a **load** event.
