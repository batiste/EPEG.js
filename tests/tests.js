
var tokens = [
  {key:"number", reg:/^-?[0-9]+\.?[0-9]*/},
  {key:"term", reg:/^[\+|-]/},
  {key:"fact", reg:/^[\*|/]/},
  {key:"w", reg:/^[ ]/},
  {key:"func_def", reg:/^def/},
  {key:"name", reg:/^[a-zA-Z]+/},
  {key:"dot", reg:/^\./},
  {key:"openP", reg:/^\(/},
  {key:"closeP", reg:/^\)/},
  {key:"comma", reg:/^\,/},
  {key:"openB", reg:/^\[/},
  {key:"closeB", reg:/^\]/},
  {key:"assign", reg:/^\=/},
  {key:"newLine", reg:/^\n/},
];

var grammar = {
  "TERM": {rules:["TERM w? term w? FACT", "FACT"]},
  "FACT": {rules:["FACT w? fact w? number", "number"]},
  "PATH": {rules:["PATH dot name", "name"]},
  "ASSIGN": {rules:["PATH w? assign w? EXPR"]},
  "FUNC_PARAMS": {rules:["FUNC_PARAMS comma w? name", "name?"]},
  "FUNC_DEF": {rules:["func_def w name openP FUNC_PARAMS closeP"]},
  "COMMA_SEPARATED_EXPR": {rules:["COMMA_SEPARATED_EXPR comma w EXPR", "EXPR"]},
  "FUNC_CALL": {rules:["PATH openP FUNC_PARAMS closeP"]},
  "EXPR": {rules:["name comma EXPR", "EXPR dot EXPR", "openP EXPR closeP", "EXPR openB EXPR closeB", "PATH", "TERM"]},
  "START": {rules: ["FUNC_CALL EOF", "ASSIGN EOF", "EXPR EOF", "FUNC_DEF EOF"]}
};

var gram = EPEG.compileGrammar(grammar, tokens);

function assertComplete(input, g, log) {

  QUnit.test( input, function( assert ) {

    var r = g.parse(input);
    var ts = EPEG.tokenize(input, g);
    if(log) {
      console.log(r, ts);
    }

    if(!r.complete) {
      console.log(r.hint);
    }

    assert.ok( r.complete, input );
  });
}

function assertIncomplete(input, g, log) {
  QUnit.test( input, function( assert ) {
    var r = g.parse(input);
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
assertComplete("(0).(9)", gram);
assertComplete("(9).((0))", gram);

assertIncomplete("abc.der.[0][0]", gram);

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

function m2(p) {
  return p.$1;
}


var grammar = {
  "LINE": {rules: ["n:number newLine", "comma number newLine"], hooks: [m1, m2]},
  "START": {rules: ["LINE* EOF"]}
};

var gram2 = EPEG.compileGrammar(grammar, tokens);


assertComplete("6\n6\n", gram2);
assertIncomplete("6\n6\n6", gram2);


QUnit.test( "Test that function calling with naming works", function( assert ) {
  var parsed = EPEG.parse("6\n6\n", gram2);
  assert.equal( parsed.children[0].children.value, 6 );
});

QUnit.test( "Test that function calling with $ works", function( assert ) {
  var parsed = EPEG.parse(",12\n", gram2);
  assert.equal( parsed.children[0].children.value, 12 );
});



tokens = [
  {key:"number", reg:/^-?[0-9]+\.?[0-9]*/},
  {key:"math", reg:/^[\+|-|\*|/]/},
  {key:"fact", reg:/^[\*|/]/},
  {key:"w", reg:/^[ ]/},
  {key:"func_def", reg:/^def/},
  {key:"name", reg:/^[a-zA-Z][a-zA-Z1-9]*/},
  {key:"dot", reg:/^\./},
  {key:"openP", reg:/^\(/},
  {key:"closeP", reg:/^\)/},
  {key:"comma", reg:/^\,/},
  {key:"openB", reg:/^\[/},
  {key:"closeB", reg:/^\]/},
  {key:"assign", reg:/^\=/},
  {key:"newLine", reg:/^\n/},
];

grammar = {
  "MATH": {rules:["EXPR w? math w? EXPR"]},
  "PATH": {rules:["PATH dot name", "name"]},
  "ASSIGN": {rules:["PATH w? assign w? EXPR"]},
  "FUNC_PARAMS": {rules:["FUNC_PARAMS comma w? name", "name?"]},
  "FUNC_DEF": {rules:["func_def w name openP FUNC_PARAMS closeP"]},
  "FUNC_CALL_PARAMS": {rules:["FUNC_CALL_PARAMS comma w? EXPR", "EXPR?"]},
  "FUNC_CALL": {rules:["PATH openP FUNC_CALL_PARAMS closeP"]},
  "EXPR": {rules: [
    "MATH",
    "EXPR dot EXPR",
    "openP EXPR closeP",
    "EXPR openB EXPR closeB",
    "FUNC_CALL",
    "number",
    "PATH"]},
  "STATEMENT": {rules: ["ASSIGN", "EXPR", "FUNC_DEF"]},
  "LINE": {rules: ["w* STATEMENT newLine"]},
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

assertComplete("hello.path = 1 + 1 + (hello + 2)\n", gram3);


assertComplete("hello[0][0][0].hello.test()[0]\n", gram3);
assertComplete("hello().test[0].hello().hello[0]\n", gram3);

assertComplete("hello.hello()\n", gram3);


assertComplete("hello.hello.test.toto\n", gram3);

assertComplete("(1 + 1).test()\n", gram3);

assertComplete("(1).hello()\n", gram3);

assertComplete("hello.5\n", gram3);

assertComplete("def test(a, b)\n  a = 1\nb = 2\ntest(1, 2)\n", gram3);


tokens = [
  {key:"isHello", func:function(input) { if(input == 'hello'){ return input; }} },
  {key:"w", reg:/^[ ]/},
  {key:"n", reg:/^[a-z]+/},
];

grammar = {
  "START": {rules: ["isHello EOF"]}
};

var gram4 = EPEG.compileGrammar(grammar, tokens);

assertComplete("hello", gram4, true);
assertIncomplete(" hello", gram4);
assertIncomplete("hello ", gram4);


tokens = [
  {key:"number", reg:/^[0-9]/},
  {key:"a", reg:/^a/},
  {key:"b", reg:/^b/},
  {key:"c", reg:/^c/},
];

grammar = {
  "EXPR": {rules: [ "EXPR b EXPR", "EXPR c EXPR", "a EXPR a", "number"]},
  "START": {rules: ["EXPR EOF"]}
};

var gram5 = EPEG.compileGrammar(grammar, tokens);

assertComplete("1b1", gram5);
assertComplete("1c1", gram5);
assertComplete("a1a", gram5);
assertComplete("1ba1a", gram5);
assertComplete("a1ab1", gram5);
assertComplete("a1aba2a", gram5);
assertComplete("1b1c1", gram5);
assertComplete("1c1b1", gram5);


tokens = [
  {key:"number", reg:/^[0-9]/},
  {key:"openP", reg:/^\(/},
  {key:"closeP", reg:/^\)/},
];


grammar = {
  "EXPR": {rules:["openP EXPR closeP", "number"]},
  "START": {rules: ["EXPR EOF"]}
};

var gram6 = EPEG.compileGrammar(grammar, tokens);

assertComplete("0", gram6);
assertComplete("(0)", gram6);
assertComplete("((0))", gram6);
assertComplete("(((9)))", gram6);

tokens = [
  {key:"number", reg:/^[0-9]/},
  {key:"w", reg:/^[ ]/},
];

grammar = {
  "EXPR": {rules:["number w"]},
  "START": {rules: ["EXPR* EOF"]}
};

var gram6 = EPEG.compileGrammar(grammar, tokens);


assertComplete("1 1 1 1 ", gram6);
assertComplete("1 ", gram6);
assertComplete("", gram6);

QUnit.test("Test * works on the START", function( assert ) {
  var parsed = EPEG.parse("1 2 ", gram6);
  assert.equal(parsed.children[0].children[0].value, 1);
  assert.equal(parsed.children[1].children[0].value, 2);
});

var hook1 = function(p) {
  return [p.n];
};

grammar = {
  "EXPR": {rules:["n:number w"], hooks:[hook1]},
  "START": {rules: ["EXPR+ EOF"]}
};

var gram7 = EPEG.compileGrammar(grammar, tokens);
assertComplete("1 ", gram7);
assertComplete("1 2 ", gram7);
assertIncomplete("", gram7);


QUnit.test("Test hooks", function( assert ) {
  var parsed = EPEG.parse("1 2 3 ", gram7);
  assert.equal(parsed.children[0].children.length, 1);
  assert.equal(parsed.children[0].children[0].value, 1);
  assert.equal(parsed.children[1].children.length, 1);
  assert.equal(parsed.children[1].children[0].value, 2);
  assert.equal(parsed.children[2].children.length, 1);
  assert.equal(parsed.children[2].children[0].value, 3);
});


var hook2 = function(p) {
  return [p.e, p.n];
};

var hook3 = function(p) {
  return [p.n];
};


grammar = {
  "EXPR2": {rules:["e:EXPR2 w n:number", "n:number"], hooks:[hook2, hook3]},
  "START": {rules: ["EXPR2 EOF"]}
};

var gram8 = EPEG.compileGrammar(grammar, tokens);
assertComplete("1", gram8);
assertComplete("1 2", gram8);
assertComplete("1 2 3", gram8);
assertIncomplete("", gram8);

QUnit.test("Test hooks 2", function( assert ) {
  var parsed = EPEG.parse("1 2 3", gram8);
  assert.equal(parsed.children[0].children.length, 2);
  assert.equal(parsed.children[0].children[1].value, 3);
  assert.equal(parsed.children[0].children[0].children[1].value, 2);
  assert.equal(parsed.children[0].children[0].children[0].children[0].value, 1);
});


grammar = {
  "START": {rules: ["w EOF+"]}
};

var gram9 = EPEG.compileGrammar(grammar, tokens);
assertComplete(" ", gram9);
assertIncomplete("  ", gram9);
assertIncomplete("", gram9);


// this is an indirect recursion grammar which
// is not supposed to work whith this library yet

tokens = [
  {key:"a", reg:/^a/},
  {key:"b", reg:/^b/},
];

grammar = {
  "START": {rules: ["A EOF"]},
  "A": {rules:["A a", "B", "a"]},
  "B": {rules:["B b", "A", "b"]}
};

/*
decomposition of "baba"

 A a
 |
 B->B b
    |
    A->A a
       |
       B -> b

A -> B b -> A a -> B -> b

A -> Aba


*/


var gram10 = EPEG.compileGrammar(grammar, tokens);

assertComplete("ab", gram10);
assertComplete("aaaabbbb", gram10);

assertComplete("bbbbaaaa", gram10);
assertComplete("aba", gram10);
assertComplete("bab", gram10);
assertIncomplete("", gram10);
assertComplete("baba", gram10);
assertComplete("abab", gram10);
