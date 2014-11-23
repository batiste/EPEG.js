
var tokens = {
  number: /^-?[0-9]+\.?[0-9]*/,
  term: /^[\+|-]/,
  fact: /^[\*|/]/,
  w: /^[ ]/,
  func_def: /^def/,
  name: /^[a-zA-Z]+/,
  dot: /^\./,
  openP: /^\(/,
  closeP: /^\)/,
  comma: /^\,/,
  openB: /^\[/,
  closeB: /^\]/,
  assign: /^\=/,
  newLine: /^\n/,
};

var grammar = {
  "TERM": {rules:["TERM w? term w? FACT", "FACT"]},
  "FACT": {rules:["FACT w? fact w? number", "number"]},
  "PATH": {rules:["PATH dot name", "name"]},
  "ASSIGN": {rules:["PATH w? assign w? EXPR"]},
  "FUNC_PARAMS": {rules:["FUNC_PARAMS comma w? name", "name?"]},
  "FUNC_DEF": {rules:["func_def w name openP FUNC_PARAMS closeP"]},
  "COMMA_SEPARATED_EXPR": {rules:["COMMA_SEPARATED_EXPR comma w EXPR", "EXPR"]},
  "FUNC_CALL": {rules:["PATH openP FUNC_PARAMS closeP"]},
  "EXPR": {rules:["name comma EXPR", "openP EXPR closeP", "PATH openB EXPR closeB", "PATH", "TERM"]},
  "START": {rules: ["FUNC_CALL EOF", "ASSIGN EOF", "EXPR EOF", "FUNC_DEF EOF"]}
};

var gram = EPEG.compileGrammar(grammar, tokens);

function assertComplete(input, g, log) {

  QUnit.test( input, function( assert ) {

    var r = EPEG.parse(input, g);
    var ts = EPEG.tokenize(input, g.tokenDef);
    if(log) {
      console.log(r, ts);
    }

    var msg = "Incomplete parsing on: " + input + ", leftover " + ts.slice(r.consumed).map(function(i){return i.value;});

    assert.ok( r.complete, input );
  });
}

function assertIncomplete(input, g, log) {
  QUnit.test( input, function( assert ) {
    var r = EPEG.parse(input, g);
    assert.ok( !r.complete, input );
  });
}


// test left recursion
assertComplete("1", gram);
assertComplete("1 + 1", gram);
assertComplete("1 + 1 - 1", gram);
assertComplete("1 + 1 * 1 - 1 / 1 + 1", gram);
assertIncomplete("1 + ", gram);
assertIncomplete("+ 1", gram);

// test right recursion
assertComplete("a,b,c,1", gram);

// middle recursion
assertComplete("(0)", gram);

assertIncomplete("abc.der[0][0]", gram);

assertIncomplete("[0][0]", gram);

assertComplete("abc", gram);

// assign
assertComplete("abc=1", gram);
assertComplete("abc = 1", gram);
assertComplete("abc = abc[0]", gram);
assertComplete("abc.der = 1", gram);
assertComplete("abc.der.sdf=(1)", gram);

// func definition
assertComplete("def func()", gram);
assertComplete("def func(a, b)", gram);


// func call
assertComplete("a.b.func()", gram);
assertComplete("func()", gram);
assertComplete("func(a, b)", gram);
assertComplete("func(a, b, d, e)", gram);

assertComplete("func(a,b, c)", gram);
assertIncomplete("func(a,b,  c)", gram);

assertIncomplete("func(a,b,c),", gram);
assertIncomplete("func(a,b,c)1", gram);

assertIncomplete("1 func(a)", gram);

grammar = {
  "TEST2": {rules:["openP"]},
  "TEST": {rules:["name comma TEST", "name comma"]},
  "EXPR": {rules:["number dot* name", "w number w number?"]},
  "START": {rules: ["EXPR EOF", "TEST EOF", "number comma TEST? comma EOF", "TEST2* closeP EOF"]}
};

gram = EPEG.compileGrammar(grammar, tokens);

assertComplete("6.....hello", gram);
assertComplete("6hello", gram);
assertIncomplete("6.....6", gram);

assertComplete(" 6 6", gram);
assertComplete(" 6 ", gram);
assertIncomplete(" 6 6 6", gram);

assertComplete("test,test,hello,", gram);

assertComplete("6,test,,", gram);
assertIncomplete("6,test,", gram);
assertComplete("6,,", gram);

assertComplete("()", gram);
assertComplete("((()", gram);
assertComplete(")", gram);
assertIncomplete("))", gram);

function m1(p) {
  return p.n;
}

var grammar = {
  "LINE": {rules: ["n:number newLine"], funcs: [m1]},
  "START": {rules: ["LINE* EOF"]}
};

var gram2 = EPEG.compileGrammar(grammar, tokens);


assertComplete("6\n6\n", gram2);
assertIncomplete("6\n6\n6", gram2);


QUnit.test( "Test that function calling with naming works", function( assert ) {
  var parsed = EPEG.parse("6\n6\n", gram2);
  assert.equal( parsed.children[0].children.value, 6 );
});


tokens = {
  number: /^-?[0-9]+\.?[0-9]*/,
  math: /^[\+|-|\*|/]/,
  fact: /^[\*|/]/,
  w: /^[ ]/,
  func_def: /^def/,
  name: /^[a-zA-Z]+/,
  dot: /^\./,
  openP: /^\(/,
  closeP: /^\)/,
  comma: /^\,/,
  openB: /^\[/,
  closeB: /^\]/,
  assign: /^\=/,
  newLine: /^\n/,
};

grammar = {
  "MATH": {rules:["EXPR w? math w? EXPR"]},
  "PATH": {rules:["PATH dot name", "name"]},
  "ASSIGN": {rules:["PATH assign number"]},
  "FUNC_PARAMS": {rules:["FUNC_PARAMS comma w? name", "name?"]},
  "FUNC_DEF": {rules:["func_def w name openP FUNC_PARAMS closeP"]},
  "FUNC_CALL_PARAMS": {rules:["FUNC_CALL_PARAMS comma w? EXPR", "EXPR?"]},
  "FUNC_CALL": {rules:["PATH openP FUNC_CALL_PARAMS closeP"]},
  "EXPR": {rules: ["MATH", "EXPR openP EXPR closeP", "EXPR openB EXPR closeB", "FUNC_CALL", "number", "name"]},
  "STATEMENT": {rules: ["ASSIGN", "EXPR", "FUNC_DEF"]},
  "LINE": {rules: ["STATEMENT newLine"]},
  "START": {rules: ["LINE* EOF"]}
};

var gram3 = EPEG.compileGrammar(grammar, tokens);

assertComplete("a=1\n", gram3);
assertComplete("def test(a, b, c)\n", gram3);
assertIncomplete("def test(a, 1, c)\n", gram3);
assertComplete("test()\n", gram3);
assertComplete("test(1, 1+2, toto)\n", gram3);
assertComplete("1 + 2 + 3\n", gram3);
assertComplete("name + 1\n", gram3);
assertComplete("name() + name() + 1\n", gram3);

assertComplete("name + 1\ntoto() + 3\n", gram3);
assertIncomplete("name + 1\ntoto() + 3", gram3);




