# ggml (inside transcribe.cpp, dictation's speech engine) accepts MSVC cl.exe on ARM only when it
# tunes itself to the build machine (GGML_NATIVE), which a distributed build must not, so the
# ARM64 bundle compiles it with clang-cl. Use the MSVC ABI, headers, and libraries supplied by the
# Windows runner, with an explicit cross target.
# This file is selected only for the Windows ARM64 bundle, after host binding generation.
# cmake-rs obtains the ARM64 MSVC/SDK LIB, INCLUDE, and PATH from cc and forwards them to
# both configure and Ninja. Keep normal executable compiler/link checks enabled here.
set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR ARM64)
find_program(AURACODE_CLANG_CL NAMES clang-cl REQUIRED)
set(CMAKE_C_COMPILER "${AURACODE_CLANG_CL}")
set(CMAKE_CXX_COMPILER "${AURACODE_CLANG_CL}")
set(CMAKE_C_COMPILER_TARGET aarch64-pc-windows-msvc)
set(CMAKE_CXX_COMPILER_TARGET aarch64-pc-windows-msvc)
# cmake-rs supplies CMAKE_CXX_FLAGS itself, replacing CMake's default /EHsc. GGUF uses
# try/catch, which clang-cl rejects without exception handling. Keep this C++-only.
add_compile_options("$<$<COMPILE_LANGUAGE:CXX>:/EHsc>")
