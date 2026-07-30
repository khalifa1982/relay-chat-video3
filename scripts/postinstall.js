#!/usr/bin/env node
/**
 * postinstall: patch react-native-callkeep podspec to use 'React-Core'
 * instead of deprecated 'React' pod dependency.
 */
const fs = require('fs');
const path = require('path');

const podspecPath = path.join(
  __dirname, '..', 'node_modules', 'react-native-callkeep', 'RNCallKeep.podspec'
);

if (fs.existsSync(podspecPath)) {
  let content = fs.readFileSync(podspecPath, 'utf8');
  if (content.includes("s.dependency 'React'") && !content.includes("s.dependency 'React-Core'")) {
    content = content.replace("s.dependency 'React'", "s.dependency 'React-Core'");
    fs.writeFileSync(podspecPath, content);
    console.log('[postinstall] Patched react-native-callkeep podspec: React -> React-Core');
  } else {
    console.log('[postinstall] react-native-callkeep podspec already patched or not found');
  }
} else {
  console.log('[postinstall] react-native-callkeep not installed, skipping patch');
}
