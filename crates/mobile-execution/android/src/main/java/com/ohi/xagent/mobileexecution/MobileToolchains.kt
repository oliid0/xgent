package com.ohi.xagent.mobileexecution

import java.io.File

internal data class MobileToolchainDefinition(
    val id: String,
    val label: String,
    val packages: List<String>,
    val probes: List<String>,
    val detail: String,
)

internal data class MobileToolchainState(
    val definition: MobileToolchainDefinition,
    val installed: Boolean,
    val version: String? = null,
)

internal object MobileToolchains {
    val definitions = listOf(
        MobileToolchainDefinition(
            id = "essentials",
            label = "Linux essentials",
            packages = listOf(
                "bash", "coreutils", "findutils", "grep", "sed", "gawk", "less",
                "nano", "vim", "curl", "wget", "git", "openssh-client-default", "file",
                "jq", "tar", "zip", "unzip", "xz",
            ),
            probes = listOf("bin/bash", "usr/bin/git", "usr/bin/curl"),
            detail = "Common Unix tools, Git, SSH, editors, archives, curl and wget",
        ),
        MobileToolchainDefinition(
            id = "python",
            label = "Python and pip",
            packages = listOf("python3", "py3-pip", "py3-virtualenv"),
            probes = listOf("usr/bin/python3", "usr/bin/pip3"),
            detail = "Python 3, pip and virtual environments",
        ),
        MobileToolchainDefinition(
            id = "node",
            label = "Node.js and npm",
            packages = listOf("nodejs", "npm"),
            probes = listOf("usr/bin/node", "usr/bin/npm"),
            detail = "Node.js and npm inside Alpine PRoot",
        ),
        MobileToolchainDefinition(
            id = "go",
            label = "Go",
            packages = listOf("go"),
            probes = listOf("usr/bin/go"),
            detail = "Go compiler and module tooling",
        ),
        MobileToolchainDefinition(
            id = "rust",
            label = "Rust and Cargo",
            packages = listOf("rust", "cargo"),
            probes = listOf("usr/bin/rustc", "usr/bin/cargo"),
            detail = "Rust compiler and Cargo",
        ),
        MobileToolchainDefinition(
            id = "cpp",
            label = "C/C++ build tools",
            packages = listOf("build-base", "clang", "llvm", "cmake", "ninja"),
            probes = listOf("usr/bin/cc", "usr/bin/clang", "usr/bin/cmake"),
            detail = "GCC, Clang, CMake and Ninja",
        ),
        MobileToolchainDefinition(
            id = "media",
            label = "Media tools",
            packages = listOf("ffmpeg", "imagemagick"),
            probes = listOf("usr/bin/ffmpeg", "usr/bin/ffprobe", "usr/bin/convert"),
            detail = "FFmpeg, ffprobe and ImageMagick",
        ),
        MobileToolchainDefinition(
            id = "documents",
            label = "Document tools",
            packages = listOf("pandoc-cli"),
            probes = listOf("usr/bin/pandoc"),
            detail = "Pandoc document conversion",
        ),
    )

    private val byId = definitions.associateBy { it.id }

    fun resolve(ids: List<String>): List<MobileToolchainDefinition> {
        val normalized = ids.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        require(normalized.isNotEmpty()) { "at least one toolchain is required" }
        return normalized.map { id ->
            byId[id] ?: error("unknown Android toolchain: $id")
        }
    }

    fun inspect(rootfs: File): List<MobileToolchainState> = definitions.map { definition ->
        MobileToolchainState(
            definition = definition,
            installed = definition.probes.all { relative -> File(rootfs, relative).isFile },
        )
    }

    fun installCommand(definitions: List<MobileToolchainDefinition>): String {
        val packages = definitions.flatMap { it.packages }.distinct()
        check(packages.all { PACKAGE_NAME.matches(it) }) { "invalid package in toolchain catalog" }
        return "apk add --no-cache ${packages.joinToString(" ")}"
    }

    private val PACKAGE_NAME = Regex("[a-z0-9][a-z0-9+._-]{0,63}")
}
