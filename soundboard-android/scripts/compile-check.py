#!/usr/bin/env python3
"""Compiles the Android app's Kotlin (app/ and core/) against an android.jar,
without the Android Gradle plugin, aapt2 or the SDK: a quick check that the
code is right where the full build can't run.

    python3 scripts/compile-check.py <android.jar>

Any android.jar for API 35 works: the SDK's platforms/android-35/android.jar,
or Robolectric's org.robolectric:android-all:15-robolectric-13954326 from
Maven Central. The R class aapt2 would make is stood in for from res/.
"""
import glob, os, re, subprocess, sys, tempfile

android = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
jar = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else sys.exit(__doc__)
work = tempfile.mkdtemp(prefix='app-compile-check-')
res = os.path.join(android, 'app/src/main/res')

ids = iter(range(0x7f010001, 0x7f020000))
def names(pattern, strip_ext=True):
    out = set()
    for d in glob.glob(os.path.join(res, pattern)):
        for f in os.listdir(d):
            out.add(os.path.splitext(f)[0] if strip_ext else f)
    return sorted(out)
groups = {
    'string': re.findall(r'<string name="([^"]+)"', open(os.path.join(res, 'values/strings.xml')).read()),
    'drawable': names('drawable*'),
    'mipmap': names('mipmap*'),
}
gen = os.path.join(work, 'gen/com/dungeonradio/app')
os.makedirs(gen)
with open(os.path.join(gen, 'R.kt'), 'w') as f:
    f.write('package com.dungeonradio.app\n\nobject R {\n')
    for group, items in groups.items():
        f.write(f'    object {group} {{\n' + ''.join(f'        const val {n} = {next(ids)}\n' for n in sorted(items)) + '    }\n')
    f.write('}\n')

open(os.path.join(work, 'settings.gradle.kts'), 'w').write('dependencyResolutionManagement { repositories { mavenCentral() } }\nrootProject.name = "compilecheck"\n')
open(os.path.join(work, 'build.gradle.kts'), 'w').write(f'''plugins {{ kotlin("jvm") version "2.1.21" }}
java {{ sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }}
kotlin {{ compilerOptions {{ jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }} }}
sourceSets["main"].kotlin.srcDirs("{android}/core/src/main/kotlin", "{android}/app/src/main/kotlin", "gen")
dependencies {{
    compileOnly(files("{jar}"))
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.java-websocket:Java-WebSocket:1.5.7")
}}
''')
gradle = '/opt/gradle/bin/gradle' if os.path.exists('/opt/gradle/bin/gradle') else 'gradle'
sys.exit(subprocess.call([gradle, '-q', '--console=plain', 'compileKotlin'], cwd=work))
