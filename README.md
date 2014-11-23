EPEG.js - Expressive Parsing Expression Grammar
================================================

A top down parser that can handle left recursion by using a stack and backtracking.

Typical PEG parser cannot handle left recursion.
This project is an attempt to solve this problem by using a stack to detect recursion
and backtrack when necessary. I used this paper as inspiration:

http://www.vpri.org/pdf/tr2007002_packrat.pdf

Indirect recursion is not implemented yet.

Example of a valid grammar

```javascript
var tokensDef = {
  number: /^-?[0-9]+\.?[0-9]*/,
  operator: /^[-|\+|\*|/|%]/,
  w: /^[ ]/
};

var grammarDef = {
  "MATH": {rules:["MATH w operator w number", "number w operator w number"]},
  "START": {rules: ["MATH"]}
};

var parser = EPEG.compileGrammar(grammarDef, tokensDef);

function valid(input) {
  var AST = parser.parse(stream);
  if(!AST.complete) {
    throw "Incomplete parsing"
  }
}

valid("1 + 1");
valid("1 + 1 - 4");
```

## Other features

### Modifiers

Every item in a rule/token in the grammar can use the modifiers * and ?. E.g using the tokensDef above:

```javascript
var grammarDef = {
  "REPEAT": {rules: ["number w"]}
  "START": {rules: ["REPEAT*"]}
};

parser = EPEG.compileGrammar(grammarDef, tokensDef);

valid("1 2 3 ");
valid("");
valid("1"); // Should throw an error as the white space is missing
```

### Named tokens and functions hooks

Tokens parsed in the rules can be named. Each rules can have a hook function defined. This
function is called at parse time with a map of each named parameter or in order with $0, $1, etc.

```javascript

function numberHook(params) {
  // we reject the white space params.ws here
  // it will not apear in the AST
  return [params.num1, params.num2];
}

var grammarDef = {
  "NAMED": {rules: ["num1:number ws:w num2:number"], hooks: [numberHook]},
  "START": {rules: ["NAMED"]}
};

parser = EPEG.compileGrammar(grammarDef, tokensDef);

valid("1 2");
```

