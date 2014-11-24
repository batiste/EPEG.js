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
  "START": {rules: ["MATH EOF"]}, // You need to start you grammar with the START rule.
                                  // The special EOF token is always added automatically by the token parser.
  "MATH": {rules: [
    "MATH w operator w number",
    "number w operator w number"
  ]}
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

## Public API

There is only public function that return a parser object:

```javascript
var parser = EPEG.compileGrammar(grammar definition, tokens definition);

parser.parse(input);
```

This parse object only has the parse method that return an Abstract Syntax Tree.

## Other features

### Tokenizer function

If a regexp is not the right tool for the job feel you can use a function.
The contract is that you need to return the matched string. This string
has to be at the start of the input.

tokens = {
  isHello: function(input) { if(input == 'hello'){ return input; } },
  w: /^[ ]/,
  n: /^[a-z]+/
};

### Modifiers

Every item in a rule/token in the grammar can use the modifiers * and ?. E.g using the tokensDef above:

```javascript
var grammarDef = {
  "REPEAT": {rules: ["number w"]}
  "START": {rules: ["REPEAT* EOF"]}
};

parser = EPEG.compileGrammar(grammarDef, tokensDef);

valid("1 2 3 ");
valid("");
valid("1"); // Should throw an error as the white space is missing
```

### Named tokens and functions hooks

Tokens parsed in the rules can be named. Each rules can have a hook function defined. This
function is called at parse time with a single parameter being the map of each named parameter.
This map also contains all the matched tokens in order with $0, $1, etc.

```javascript

function numberHook(params) {
  // We reject the white space params.ws here
  // it will not apear in the AST
  return [params.num1, params.num2];
  // Could also have been written
  return [params.$0, params.$2];
}

var grammarDef = {
  "NAMED": {rules: ["num1:number ws:w num2:number"], hooks: [numberHook]},
  "START": {rules: ["NAMED EOF"]}
};

parser = EPEG.compileGrammar(grammarDef, tokensDef);

valid("1 2");
```

