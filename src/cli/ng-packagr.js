#! /usr/bin/env node

"use strict";

const path = require('path');

// Read CLI arguments
const ARGS = require('minimist')(process.argv.slice(2));

const project = ARGS.p || ARGS.project || path.resolve(process.cwd(), 'ng-package.json');
const cleanDestination = ARGS.c || ARGS.clean || 'true';
const buildUmd = ARGS.u || ARGS.umd || 'true';

const ngPackagr = require('../lib/ng-packagr');

ngPackagr.ngPackage({
  project,
  cleanDestination,
  buildUmd
})
.catch((err) => process.exit(111));
