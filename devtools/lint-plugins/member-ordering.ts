/**
 * Deno lint plugin that requires class fields to be declared at the top of
 * the class body, before the constructor and any methods.
 *
 * A field buried between methods is easy to miss when reasoning about a
 * class's state. Constructor-parameter properties are unaffected.
 */

export default {
  name: "custom-member-ordering",
  rules: {
    "member-ordering": {
      create(context) {
        return {
          ClassBody(node: Deno.lint.ClassBody) {
            const firstMethodIndex = node.body.findIndex(
              (member) => member.type === "MethodDefinition",
            );
            if (firstMethodIndex === -1) return;
            node.body
              .filter(
                (member, index): member is Deno.lint.PropertyDefinition =>
                  index > firstMethodIndex &&
                  member.type === "PropertyDefinition",
              )
              .forEach((member) =>
                context.report({
                  node: member,
                  message:
                    "Declare class fields at the top of the class, before the constructor and methods.",
                })
              );
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
