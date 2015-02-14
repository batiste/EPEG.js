"use strict";

var gulp = require("gulp");
var browserify = require("browserify");
var source = require("vinyl-source-stream");
var uglify = require('gulp-uglify');
var streamify = require('gulp-streamify');
var stylish = require("jshint-stylish");
var jshint = require("gulp-jshint");
var istanbul = require('gulp-istanbul');
var mocha = require('gulp-mocha');

function build() {
  return browserify("./EPEG.js", {
      debug: true,
      standalone: "EPEG"
    })
    .bundle()
    .pipe(source("EPEG.js"))
    .pipe(gulp.dest("./dist"));
}

function release() {
  return browserify("./EPEG.js", {
      debug: false,
      standalone: "EPEG"
    })
    .bundle()
    .pipe(source("EPEG.min.js"))
    .pipe(streamify(uglify()))
    .pipe(gulp.dest("./dist"));
}

gulp.task("build", build);
gulp.task("default", build);
gulp.task("release", release);
gulp.task("jshint", function() {
  return gulp.src("EPEG.js")
    .pipe(jshint())
    .pipe(jshint.reporter(stylish));
});

gulp.task("test", ['build'], function() {
  gulp.src(['dist/EPEG.js'])
    .pipe(istanbul()) // Covering files
    .pipe(istanbul.hookRequire()) // Force `require` to return covered files
    .on('finish', function () {
      gulp.src(['test/*.js'])
        .pipe(mocha())
        .pipe(istanbul.writeReports()); // Creating the reports after tests runned
    });
});
