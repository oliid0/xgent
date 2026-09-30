package com.ohi.xgent.mobileexecution

import android.content.Context
import android.net.ConnectivityManager
import android.system.Os
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

internal object RootfsEnvironment {
    data class AlpineMirror(val id: String, val name: String, val baseUrl: String)

    val alpineMirrors = listOf(
        AlpineMirror("official", "Official CDN", "https://dl-cdn.alpinelinux.org/alpine"),
        AlpineMirror("tuna", "Tsinghua TUNA", "https://mirrors.tuna.tsinghua.edu.cn/alpine"),
        AlpineMirror("aliyun", "Alibaba", "https://mirrors.aliyun.com/alpine"),
        AlpineMirror("ustc", "USTC", "https://mirrors.ustc.edu.cn/alpine"),
        AlpineMirror("huawei", "Huawei", "https://repo.huaweicloud.com/alpine"),
        AlpineMirror("tencent", "Tencent", "https://mirrors.cloud.tencent.com/alpine"),
        AlpineMirror("leaseweb", "LEASEWEB UK", "https://mirror.leaseweb.com/alpine"),
        AlpineMirror("rwth", "RWTH Germany", "https://ftp.halifax.rwth-aachen.de/alpine"),
        AlpineMirror("jaist", "JAIST Japan", "https://ftp.jaist.ac.jp/pub/Linux/alpine"),
        AlpineMirror("kakao", "Kakao Korea", "https://mirror.kakao.com/alpine"),
    )

    fun selectedMirror(context: Context): AlpineMirror {
        val id = context.getSharedPreferences(MIRROR_PREFS, Context.MODE_PRIVATE)
            .getString(MIRROR_KEY, "official")
        return alpineMirrors.firstOrNull { it.id == id } ?: alpineMirrors.first()
    }

    fun selectMirror(context: Context, rootfs: File, id: String) {
        val mirror = alpineMirrors.firstOrNull { it.id == id }
            ?: throw IllegalArgumentException("Unknown Alpine mirror")
        val previous = selectedMirror(context)
        val repositories = File(rootfs, "etc/apk/repositories")
            .takeIf { File(rootfs, "bin/sh").isFile }
        val branch = repositories?.let { file ->
            ALPINE_BRANCH.find(file.takeIf { it.isFile }?.readText().orEmpty())
                ?.value ?: error("Installed Alpine repository branch is unavailable")
        }
        if (repositories != null && branch != null) {
            writeRepositories(repositories, branch, mirror)
        }
        val saved = context.getSharedPreferences(MIRROR_PREFS, Context.MODE_PRIVATE)
            .edit().putString(MIRROR_KEY, mirror.id).commit()
        if (!saved) {
            if (repositories != null && branch != null) {
                runCatching { writeRepositories(repositories, branch, previous) }
            }
            error("Could not save the Alpine mirror selection")
        }
    }

    fun prepare(rootfs: File, context: Context, alpineBranch: String? = null) {
        val etc = File(rootfs, "etc").apply { mkdirs() }
        if (alpineBranch != null) {
            require(ALPINE_BRANCH.matches(alpineBranch)) { "invalid Alpine repository branch" }
            writeRepositories(File(etc, "apk/repositories"), alpineBranch, selectedMirror(context))
        }
        File(etc, "resolv.conf").writeText(resolverConfig(context))
        File(etc, "hosts").apply {
            if (!isFile || !readText().contains("127.0.0.1")) {
                writeText("127.0.0.1 localhost\n::1 localhost ip6-localhost ip6-loopback\n")
            }
        }
        File(etc, "hostname").apply {
            if (!isFile || readText().isBlank()) writeText("xgent-mobile\n")
        }
        listOf("root", "tmp", "var/tmp").forEach { relative ->
            File(rootfs, relative).mkdirs()
        }
        // 01777: world-writable with sticky bit, matching a normal Linux rootfs.
        runCatching { Os.chmod(File(rootfs, "tmp").absolutePath, 1023) }
        runCatching { Os.chmod(File(rootfs, "var/tmp").absolutePath, 1023) }
    }

    private fun writeRepositories(file: File, branch: String, mirror: AlpineMirror) {
        file.parentFile?.mkdirs()
        val staging = File.createTempFile("repositories-", ".tmp", file.parentFile)
        try {
            staging.writeText(repositoryContents(branch, mirror))
            Files.move(staging.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
        } finally {
            staging.delete()
        }
    }

    fun repositoryContents(branch: String, mirror: AlpineMirror): String {
        require(ALPINE_BRANCH.matches(branch)) { "invalid Alpine repository branch" }
        return "${mirror.baseUrl}/$branch/main\n${mirror.baseUrl}/$branch/community\n"
    }

    private fun resolverConfig(context: Context): String {
        val link = runCatching {
            val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            val network = manager?.activeNetwork
            if (manager != null && network != null) manager.getLinkProperties(network) else null
        }.getOrNull()
        val servers = link?.dnsServers?.mapNotNull { it.hostAddress }?.distinct().orEmpty()
        val domains = link?.domains.orEmpty().split(Regex("[,\\s]+"))
            .filter { it.isNotBlank() && it.matches(Regex("[A-Za-z0-9._-]+")) }
            .take(6)
        return buildString {
            append("# Generated by Xgent mobile execution.\n")
            if (domains.isNotEmpty()) append("search ${domains.joinToString(" ")}\n")
            for (server in servers.ifEmpty { listOf("1.1.1.1", "8.8.8.8") }) {
                append("nameserver $server\n")
            }
            append("options edns0\n")
        }
    }

    fun proxyEnvironment(context: Context): List<String> {
        val proxy = runCatching {
            val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            manager?.defaultProxy
        }.getOrNull()
        val host = proxy?.host?.trim().orEmpty()
        val port = proxy?.port ?: 0
        if (host.isEmpty() || port !in 1..65535) return emptyList()
        val urlHost = if (host.contains(':') && !host.startsWith('[')) "[$host]" else host
        val url = "http://$urlHost:$port"
        return listOf(
            "http_proxy=$url",
            "https_proxy=$url",
            "HTTP_PROXY=$url",
            "HTTPS_PROXY=$url",
            "no_proxy=localhost,127.0.0.1,::1",
            "NO_PROXY=localhost,127.0.0.1,::1",
        )
    }

    private const val MIRROR_PREFS = "xgent-alpine-mirror"
    private const val MIRROR_KEY = "selected-mirror"
    private val ALPINE_BRANCH = Regex("v[0-9]+\\.[0-9]+")
}
