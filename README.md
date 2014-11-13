EPEG.js - Expressive Parsing Expression Grammar
================================================

A top down parser that can handle left recursion by using a stack and backtracking.

Typical PEG parser cannot handle left recursion. I tried to use it and it drives me nuts.
This project is an attempt to solve this problem by using a stack to detect recursion
and backtrack when necessary.

Example of a valid grammar

    var tokens = {
      number: /^-?[0-9]+\.?[0-9]*/,
      math: /^[-|\+|\*|/|%]/,
      w: /^[ ]/
    };

    var grammar = {
      "MATH": {rules:["number w math w number", "MATH w math w number"]},
      "START": {rules: ["MATH"]}
    };

    var gram = compile_grammar(grammar);
    function valid(input) {
      return isValidGrammar(tokenizer(input, tokens), gram);
    }

    valid("1 + 1");
    valid("1 + 1 - 4");
    
The grammar can use modifiers (* == 0 to N, ? == 0 or 1):

    var grammar = {
      "NUMBER": {rules:["number comma"]},
      "NUMBER_LIST": {rules:["NUMBER* number comma?"]}
    }
