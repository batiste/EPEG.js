"use strict";

var gulp = require("gulp");
var browserify = require("browserify");
var source = require("vinyl-source-stream");
var uglify = require('gulp-uglify');
var streamify = require('gulp-streamify');
var stylish = require("jshint-stylish");
var jshint = require("gulp-jshint");

gulp.task("build", function() {
  return browserify("./EPEG.js", {
      debug: true,
      standalone: "EPEG"
    })
    .bundle()
    .pipe(source("EPEG.js"))
    .pipe(gulp.dest("./dist"));
});


gulp.task("jshint", function() {
  gulp.src("EPEG.js")
    .pipe(jshint())
    .pipe(jshint.reporter(stylish));
});

gulp.task("release", function() {
  return browserify("./EPEG.js", {
      debug: false,
      standalone: "EPEG"
    })
    .bundle()
    .pipe(source("EPEG.min.js"))
    .pipe(streamify(uglify()))
    .pipe(gulp.dest("./dist"));
});

gulp.task("default", function() {
  gulp.start("build");
});