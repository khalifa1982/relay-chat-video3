#!/usr/bin/env node
/**
 * Verify that the Kotlin templates in with-android-fcm-call.js produce valid output.
 * Checks for common issues:
 * 1. No `const val` initialized from non-compile-time expressions
 * 2. No unresolved `BuildConfig.PACKAGE` references
 * 3. Kotlin string interpolation ${...} is properly formed
 */
const fs = require("fs");
const path = require("path");

const pluginPath = path.join(__dirname, "..", "plugins", "with-android-fcm-call.js");
const src = fs.readFileSync(pluginPath, "utf8");

let errors = 0;

// Check 1: No BuildConfig.PACKAGE (should be APPLICATION_ID or hardcoded)
if (src.includes("BuildConfig.PACKAGE")) {
  console.error("ERROR: Found BuildConfig.PACKAGE - should be BuildConfig.APPLICATION_ID or hardcoded");
  errors++;
}

// Check 2: No `const val` with non-literal initializer (BuildConfig, function calls)
// In the raw source, const val with ${PACKAGE} (unescaped) is fine because JS interpolates it to a literal string
// But const val with \${...} (escaped) would produce Kotlin interpolation which isn't compile-time
const lines = src.split("\n");
lines.forEach((line, i) => {
  // Look for const val lines that have escaped ${} (would produce Kotlin interpolation)
  if (line.includes("const val") && line.includes("\\${")) {
    console.error(`ERROR line ${i + 1}: const val with Kotlin interpolation (not compile-time): ${line.trim()}`);
    errors++;
  }
});

// Check 3: Module loads without error
try {
  delete require.cache[require.resolve(pluginPath)];
  require(pluginPath);
  console.log("✓ Module loads without error");
} catch (e) {
  console.error("ERROR: Module failed to load:", e.message);
  errors++;
}

// Check 4: Verify ACTION_ANSWER/DECLINE are hardcoded strings in output
if (src.match(/const val ACTION_ANSWER = "\$\{PACKAGE\}/)) {
  // This means the JS template will interpolate PACKAGE → "com.app.relaymobile"
  console.log("✓ ACTION_ANSWER uses JS-interpolated PACKAGE (produces literal string)");
} else if (src.match(/const val ACTION_ANSWER = "com\.app\.relaymobile/)) {
  console.log("✓ ACTION_ANSWER is hardcoded");
} else {
  console.error("ERROR: ACTION_ANSWER may not be a compile-time constant");
  errors++;
}

if (errors === 0) {
  console.log("\n✓ All Kotlin template checks passed");
  process.exit(0);
} else {
  console.error(`\n✗ ${errors} error(s) found`);
  process.exit(1);
}
