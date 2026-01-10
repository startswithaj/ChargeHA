/**
 * Deno lint plugin that forbids mutating objects passed as function parameters.
 *
 * Functions should return new values rather than modifying their inputs.
 * Mutating parameters makes code harder to reason about and can introduce
 * subtle bugs when callers don't expect their objects to change.
 *
 * Detects:
 * - Property assignment on parameters: `param.foo = value`
 * - Nested property assignment: `param.foo.bar = value`
 * - Delete on parameter properties: `delete param.foo`
 * - Mutating method calls: `param.push(...)`, `param.splice(...)`, etc.
 * - Update expressions: `param.count++`, `--param.index`
 * - Object.assign(param, ...) and Object.defineProperty(param, ...)
 */

const MUTATING_METHODS = new Set([
  // Array
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  // Map / Set
  "set",
  "delete",
  "clear",
  "add",
]);

const MUTATING_OBJECT_STATICS = new Set([
  "assign",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
]);

/** Walk a MemberExpression chain to find the root identifier. */
function getRootObject(
  node: Deno.lint.Node,
): Deno.lint.Identifier | null {
  let current = node;
  while (current.type === "MemberExpression") {
    current = (current as Deno.lint.MemberExpression).object;
  }
  return current.type === "Identifier"
    ? (current as Deno.lint.Identifier)
    : null;
}

/** Extract simple parameter names from a function's params list. */
function getParamNames(
  params: Deno.lint.FunctionDeclaration["params"],
): Set<string> {
  const names = new Set<string>();
  for (const param of params) {
    if (param.type === "Identifier") {
      names.add(param.name);
    } else if (
      param.type === "AssignmentPattern" && param.left.type === "Identifier"
    ) {
      names.add(param.left.name);
    } else if (
      param.type === "RestElement" && param.argument.type === "Identifier"
    ) {
      names.add(param.argument.name);
    }
  }
  return names;
}

/** Check if a function node is the callback of a .reduce() or .reduceRight()
 *  call, and `name` is its first parameter (the accumulator). */
function isReduceAccumulator(
  name: string,
  fn: Deno.lint.Node,
  ancestors: Deno.lint.Node[],
  fnIndex: number,
): boolean {
  const parent = fnIndex > 0 ? ancestors[fnIndex - 1] : null;
  if (!parent || parent.type !== "CallExpression") return false;

  const call = parent as Deno.lint.CallExpression;
  if (
    call.callee.type !== "MemberExpression" ||
    call.callee.property.type !== "Identifier" ||
    (call.callee.property.name !== "reduce" &&
      call.callee.property.name !== "reduceRight")
  ) return false;

  if (call.arguments.length === 0 || call.arguments[0] !== fn) return false;

  const params =
    (fn as Deno.lint.ArrowFunctionExpression | Deno.lint.FunctionExpression)
      .params;
  return params.length > 0 &&
    params[0].type === "Identifier" &&
    params[0].name === name;
}

/**
 * Find the nearest enclosing function in the ancestor chain and check
 * whether `name` is one of its parameters.
 *
 * Only checks the immediate enclosing function to avoid false positives
 * from variable shadowing in nested scopes.
 *
 * Excludes the accumulator parameter of reduce/reduceRight callbacks,
 * since mutating the accumulator is the standard reduce pattern.
 */
function isParameter(
  name: string,
  ancestors: Deno.lint.Node[],
): boolean {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const node = ancestors[i];
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      const params = getParamNames(
        node.params as Deno.lint.FunctionDeclaration["params"],
      );
      if (!params.has(name)) return false;
      if (isReduceAccumulator(name, node, ancestors, i)) return false;
      return true;
    }
  }
  return false;
}

function checkMemberMutation(
  node: Deno.lint.Node,
  memberExpr: Deno.lint.MemberExpression,
  context: Deno.lint.RuleContext,
  suffix?: string,
) {
  const root = getRootObject(memberExpr);
  if (!root) return;
  const ancestors = context.sourceCode.getAncestors(node);
  if (!isParameter(root.name, ancestors)) return;

  const msg = suffix
    ? `Do not mutate parameter '${root.name}' via ${suffix}. Return a new value instead.`
    : `Do not mutate parameter '${root.name}'. Return a new value instead.`;

  context.report({ node, message: msg });
}

export default {
  name: "custom-no-param-mutation",
  rules: {
    "no-param-mutation": {
      create(context) {
        return {
          // param.foo = value, param.foo.bar = value, param.foo += value
          AssignmentExpression(node: Deno.lint.AssignmentExpression) {
            if (node.left.type !== "MemberExpression") return;
            checkMemberMutation(node, node.left, context);
          },

          // param.count++, --param.index
          UpdateExpression(node: Deno.lint.UpdateExpression) {
            if (node.argument.type !== "MemberExpression") return;
            checkMemberMutation(node, node.argument, context);
          },

          // delete param.foo
          UnaryExpression(node: Deno.lint.UnaryExpression) {
            if (node.operator !== "delete") return;
            if (node.argument.type !== "MemberExpression") return;
            checkMemberMutation(node, node.argument, context);
          },

          CallExpression(node: Deno.lint.CallExpression) {
            const callee = node.callee;

            // param.push(...), param.splice(...), etc.
            if (
              callee.type === "MemberExpression" &&
              callee.property.type === "Identifier" &&
              MUTATING_METHODS.has(callee.property.name)
            ) {
              checkMemberMutation(
                node,
                callee,
                context,
                `'${callee.property.name}()'`,
              );
              return;
            }

            // Object.assign(param, ...), Object.defineProperty(param, ...), etc.
            if (
              callee.type === "MemberExpression" &&
              callee.object.type === "Identifier" &&
              callee.object.name === "Object" &&
              callee.property.type === "Identifier" &&
              MUTATING_OBJECT_STATICS.has(callee.property.name) &&
              node.arguments.length > 0
            ) {
              const firstArg = node.arguments[0];
              if (firstArg.type !== "Identifier") return;
              const ancestors = context.sourceCode.getAncestors(node);
              if (!isParameter(firstArg.name, ancestors)) return;
              context.report({
                node,
                message:
                  `Do not mutate parameter '${firstArg.name}' via 'Object.${callee.property.name}()'. Return a new value instead.`,
              });
            }
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
