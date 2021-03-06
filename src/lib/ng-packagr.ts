import * as path from 'path';

// BUILD STEP IMPLEMENTATIONS
import { processAssets } from './steps/assets';
import { ngc, prepareTsConfig } from './steps/ngc';
import { createPackage, readPackage } from './steps/package';
import { rollup } from './steps/rollup';
import { remapSourcemap } from './steps/sorcery';
import { downlevelWithTsc } from './steps/tsc';
import { copyFiles } from './util/copy';
import { modifyJsonFiles } from './util/json';
import { rimraf } from './util/rimraf';


// Logging
import { error, warn, info, success, debug } from './util/log';

// `ng-package.json` config
import { NgPackage } from './model/ng-package';
import { NgPackageConfig } from '../ng-package.schema';



/** CLI arguments passed to `ng-packagr` and `ngPackage()`. */
export interface NgPackagrCliArguments {
  /** Path to the 'ng-package.json' file */
  project: string,
  cleanDestination: string,
  buildUmd: string
}


export const ngPackage = (opts: NgPackagrCliArguments): Promise<any> => {
  info(`Building Angular library from ${opts.project}`);
  if (!path.isAbsolute(opts.project)) {
    opts.project = path.resolve(process.cwd(), opts.project);
  }

  /** Project configuration */
  let ngPkg: NgPackage;
  let startTime = new Date();

  // 0. READ `ng-package.json` and obtain model
  return readPackage(opts.project)
    .then((p) => {
      ngPkg = p;

      // 1. CLEAN
      if (opts.cleanDestination === 'true') {
        return Promise.all([
          rimraf(p.dest),
          rimraf(p.workingDirectory)
        ]);
      } else {
        return rimraf(p.workingDirectory);
      }
    })
    // 2. ASSETS
    .then(() => processAssets(ngPkg.src, `${ngPkg.workingDirectory}/ts`))
    // 3. NGC
    .then(() => prepareTsConfig(ngPkg, `${ngPkg.workingDirectory}/ts/tsconfig.lib.json`)
      .then((tsConfigFile: string) => ngc(tsConfigFile, `${ngPkg.workingDirectory}/ts`))
      .then((es2015EntryFile: string) => {
        info(`Compiled in ${(+new Date() - +startTime)/1000} sec`);
        return es2015EntryFile
      })
      .then((es2015EntryFile: string) =>
        // XX: see #46 - ngc only references to closure-annotated ES6 sources
        remapSourcemap(`${ngPkg.workingDirectory}/ts/${ngPkg.flatModuleFileName}.js`)
          .then(() => Promise.resolve(es2015EntryFile)))
    )
    // 4. FESM15: ROLLUP
    .then((es2015EntryFile: string) =>
      rollup({
        moduleName: ngPkg.meta.name,
        entry: es2015EntryFile,
        format: 'es',
        dest: `${ngPkg.workingDirectory}/${ngPkg.artefacts.es2015}`,
        externals: ngPkg.libExternals
      })
      // XX ... rollup generates relative paths in sourcemaps. It would be nice to re-locate source map files
      // so that `@scope/name/foo/bar.ts` shows up as path in the browser...
      .then(() => remapSourcemap(`${ngPkg.workingDirectory}/${ngPkg.artefacts.es2015}`))
    )
    // 5. FESM5: TSC
    .then(() =>
      downlevelWithTsc(
        `${ngPkg.workingDirectory}/${ngPkg.artefacts.es2015}`,
        `${ngPkg.workingDirectory}/${ngPkg.artefacts.module}`)
      .then(() => remapSourcemap(`${ngPkg.workingDirectory}/${ngPkg.artefacts.module}`))
    )
    // 6. UMD: ROLLUP
    .then(() => {
      if (opts.buildUmd === 'true') {
        return rollup({
          moduleName: ngPkg.meta.name,
          entry: `${ngPkg.workingDirectory}/${ngPkg.artefacts.module}`,
          format: 'umd',
          dest: `${ngPkg.workingDirectory}/${ngPkg.artefacts.main}`,
          externals: ngPkg.libExternals
        })
          .then(() => remapSourcemap(`${ngPkg.workingDirectory}/${ngPkg.artefacts.main}`))
      }
    })
    // 7. COPY FILES
    .then(() => copyFiles(`${ngPkg.workingDirectory}/${ngPkg.meta.scope}/**/*.{js,js.map}`, `${ngPkg.dest}/${ngPkg.meta.scope}`))
    .then(() => copyFiles(`${ngPkg.workingDirectory}/bundles/**/*.{js,js.map}`, `${ngPkg.dest}/bundles`))
    .then(() => copyFiles(`${ngPkg.workingDirectory}/ts/**/*.{d.ts,metadata.json}`, `${ngPkg.dest}`))
    .then(() => copyFiles(`${ngPkg.src}/README.md`, ngPkg.dest))
    .then(() => copyFiles(`${ngPkg.src}/LICENSE`, ngPkg.dest))
    // 8. SOURCEMAPS: RELOCATE PATHS
    // XX ... modifyJsonFiles() should maybe called 'relocateSourceMaps()' in 'steps' folder
    .then(() => modifyJsonFiles(`${ngPkg.dest}/**/*.js.map`, (sourceMap: any): any => {
      sourceMap['sources'] = sourceMap['sources']
        .map((path: string): string => path.replace('../ts',
          ngPkg.meta.scope ? `~/${ngPkg.meta.scope}/${ngPkg.meta.name}` : `~/${ngPkg.meta.name}`));

      return sourceMap;
    }))
    // 9. PACKAGE
    .then(() => createPackage(ngPkg.src, ngPkg.dest, ngPkg.artefacts))
    .then(() => {
      info(`Built in ${(+new Date() - +startTime) / 1000} sec`);
      success(`Built Angular library from ${ngPkg.src}, written to ${ngPkg.dest}`);
    })
    .catch((err) => {
      // Report error messages and throw the error further up
      error(err);
      return Promise.reject(err);
    });

}
