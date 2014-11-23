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


