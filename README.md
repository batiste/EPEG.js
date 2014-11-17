EPEG.js - Expressive Parsing Expression Grammar
================================================

A top down parser that can handle left recursion by using a stack and backtracking.

Typical PEG parser cannot handle left recursion.
This project is an attempt to solve this problem by using a stack to detect recursion
and backtrack when necessary. I used this paper as inspiration:

http://www.vpri.org/pdf/tr2007002_packrat.pdf

Indirect left recursion is not implemented yet.

Example of a valid grammar

```javascript
var tokens = {
  number: /^-?[0-9]+\.?[0-9]*/,
  math: /^[-|\+|\*|/|%]/,
  w: /^[ ]/
};

var grammar = {
  "MATH": {rules:["MATH w math w number", "number w math w number"]},
  "START": {rules: ["MATH"]}
};

var gram = EPEG.compileGrammar(grammar, tokens);
function valid(input) {
  var stream = EPEG.tokenize(input, tokens);
  return EPEG.parse(stream, gram);
}

valid("1 + 1");
valid("1 + 1 - 4");
```


