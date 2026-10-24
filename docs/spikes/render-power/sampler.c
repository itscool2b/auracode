// Power and GPU sampler for the render + power spike (docs/spikes/render-power.md). No root needed.
//
// Prints one JSON object per interval (deltas over that interval):
//   soc       SoC energy per IOReport "Energy Model" channel, as average mW (CPU, GPU, DRAM, ...)
//   gpu_util  IOAccelerator PerformanceStatistics: device/renderer/tiler utilization % (instant)
//   procs     for each pid given: CPU ms, CPU energy mJ (proc_pid_rusage v6 ri_energy_nj), package
//             idle and interrupt wakeups, and GPU ms (sum of accumulatedGPUTime over the pid's AGX
//             user clients). Processes of other users (WindowServer) report GPU ms only.
//
// Usage: sampler <interval_ms> <count> [pid ...]
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <libproc.h>
#include <mach/mach_time.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/time.h>
#include <unistd.h>

typedef struct __IOReportSubscriptionCF *IOReportSubscriptionRef;
extern CFDictionaryRef IOReportCopyChannelsInGroup(CFStringRef, CFStringRef, uint64_t, uint64_t,
                                                   uint64_t);
extern IOReportSubscriptionRef IOReportCreateSubscription(void *, CFMutableDictionaryRef,
                                                          CFMutableDictionaryRef *, uint64_t,
                                                          CFTypeRef);
extern CFDictionaryRef IOReportCreateSamples(IOReportSubscriptionRef, CFMutableDictionaryRef,
                                             CFTypeRef);
extern CFDictionaryRef IOReportCreateSamplesDelta(CFDictionaryRef, CFDictionaryRef, CFTypeRef);
extern int64_t IOReportSimpleGetIntegerValue(CFDictionaryRef, int32_t);
extern CFStringRef IOReportChannelGetChannelName(CFDictionaryRef);
extern CFStringRef IOReportChannelGetUnitLabel(CFDictionaryRef);
extern int IOReportChannelGetFormat(CFDictionaryRef);

#define MAX_PIDS 64

typedef struct {
  int pid;
  int rusage_ok;
  uint64_t cpu_ticks;
  uint64_t energy_nj;
  uint64_t idle_wakeups;
  uint64_t intr_wakeups;
  uint64_t gpu_ns;
} ProcSample;

static double now_ms(void) {
  struct timeval tv;
  gettimeofday(&tv, NULL);
  return (double)tv.tv_sec * 1000.0 + (double)tv.tv_usec / 1000.0;
}

static void json_string(CFStringRef s) {
  char buf[256];
  if (!s || !CFStringGetCString(s, buf, sizeof buf, kCFStringEncodingUTF8)) strcpy(buf, "?");
  putchar('"');
  for (char *p = buf; *p; p++) {
    if (*p == '"' || *p == '\\') putchar('\\');
    putchar(*p);
  }
  putchar('"');
}

static io_service_t accelerator(void) {
  return IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOAccelerator"));
}

static int64_t dict_int(CFDictionaryRef dict, CFStringRef key) {
  int64_t value = -1;
  CFTypeRef n = dict ? CFDictionaryGetValue(dict, key) : NULL;
  if (n && CFGetTypeID(n) == CFNumberGetTypeID()) CFNumberGetValue(n, kCFNumberSInt64Type, &value);
  return value;
}

// Sums accumulatedGPUTime (ns) of every AGX user client whose creator is `pid`.
static void gpu_times(io_service_t accel, ProcSample *procs, int count) {
  for (int i = 0; i < count; i++) procs[i].gpu_ns = 0;
  if (!accel) return;
  io_iterator_t it;
  if (IORegistryEntryCreateIterator(accel, kIOServicePlane, kIORegistryIterateRecursively, &it) !=
      KERN_SUCCESS)
    return;
  io_registry_entry_t child;
  while ((child = IOIteratorNext(it))) {
    if (IOObjectConformsTo(child, "AGXDeviceUserClient")) {
      CFStringRef creator = IORegistryEntryCreateCFProperty(child, CFSTR("IOUserClientCreator"),
                                                            kCFAllocatorDefault, 0);
      int pid = -1;
      char buf[128];
      if (creator && CFGetTypeID(creator) == CFStringGetTypeID() &&
          CFStringGetCString(creator, buf, sizeof buf, kCFStringEncodingUTF8)) {
        sscanf(buf, "pid %d", &pid);
      }
      if (creator) CFRelease(creator);
      for (int i = 0; i < count; i++) {
        if (procs[i].pid != pid) continue;
        CFArrayRef usage = IORegistryEntryCreateCFProperty(child, CFSTR("AppUsage"),
                                                           kCFAllocatorDefault, 0);
        if (usage && CFGetTypeID(usage) == CFArrayGetTypeID()) {
          for (CFIndex k = 0; k < CFArrayGetCount(usage); k++) {
            CFDictionaryRef entry = CFArrayGetValueAtIndex(usage, k);
            if (CFGetTypeID(entry) != CFDictionaryGetTypeID()) continue;
            int64_t ns = dict_int(entry, CFSTR("accumulatedGPUTime"));
            if (ns > 0) procs[i].gpu_ns += (uint64_t)ns;
          }
        }
        if (usage) CFRelease(usage);
      }
    }
    IOObjectRelease(child);
  }
  IOObjectRelease(it);
}

static void rusage_times(ProcSample *procs, int count) {
  for (int i = 0; i < count; i++) {
    struct rusage_info_v6 ri;
    memset(&ri, 0, sizeof ri);
    if (proc_pid_rusage(procs[i].pid, RUSAGE_INFO_V6, (rusage_info_t *)&ri) == 0) {
      procs[i].rusage_ok = 1;
      procs[i].cpu_ticks = ri.ri_user_time + ri.ri_system_time;
      procs[i].energy_nj = ri.ri_energy_nj;
      procs[i].idle_wakeups = ri.ri_pkg_idle_wkups;
      procs[i].intr_wakeups = ri.ri_interrupt_wkups;
    } else {
      procs[i].rusage_ok = 0;
    }
  }
}

static void print_gpu_util(io_service_t accel) {
  CFDictionaryRef perf =
      accel ? IORegistryEntryCreateCFProperty(accel, CFSTR("PerformanceStatistics"),
                                              kCFAllocatorDefault, 0)
            : NULL;
  if (perf && CFGetTypeID(perf) == CFDictionaryGetTypeID()) {
    printf("\"gpu_util\":{\"device\":%lld,\"renderer\":%lld,\"tiler\":%lld}",
           (long long)dict_int(perf, CFSTR("Device Utilization %")),
           (long long)dict_int(perf, CFSTR("Renderer Utilization %")),
           (long long)dict_int(perf, CFSTR("Tiler Utilization %")));
  } else {
    printf("\"gpu_util\":null");
  }
  if (perf) CFRelease(perf);
}

int main(int argc, char **argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: %s <interval_ms> <count> [pid ...]\n", argv[0]);
    return 2;
  }
  int interval_ms = atoi(argv[1]);
  int count = atoi(argv[2]);
  if (interval_ms < 50 || count < 1) {
    fprintf(stderr, "interval_ms must be >= 50 and count >= 1\n");
    return 2;
  }
  int npids = argc - 3 > MAX_PIDS ? MAX_PIDS : argc - 3;
  ProcSample before[MAX_PIDS], after[MAX_PIDS];
  for (int i = 0; i < npids; i++) {
    before[i] = (ProcSample){.pid = atoi(argv[3 + i])};
    after[i] = before[i];
  }

  mach_timebase_info_data_t tb;
  mach_timebase_info(&tb);

  CFDictionaryRef channels = IOReportCopyChannelsInGroup(CFSTR("Energy Model"), NULL, 0, 0, 0);
  CFMutableDictionaryRef desired =
      channels ? CFDictionaryCreateMutableCopy(kCFAllocatorDefault, 0, channels) : NULL;
  CFMutableDictionaryRef subscribed = NULL;
  IOReportSubscriptionRef sub =
      desired ? IOReportCreateSubscription(NULL, desired, &subscribed, 0, NULL) : NULL;
  if (!sub) fprintf(stderr, "IOReport Energy Model is unavailable; soc will be null\n");

  io_service_t accel = accelerator();
  rusage_times(before, npids);
  gpu_times(accel, before, npids);
  CFDictionaryRef soc_before = sub ? IOReportCreateSamples(sub, subscribed, NULL) : NULL;
  double t_before = now_ms();

  for (int n = 0; n < count; n++) {
    usleep((useconds_t)interval_ms * 1000);
    CFDictionaryRef soc_after = sub ? IOReportCreateSamples(sub, subscribed, NULL) : NULL;
    double t_after = now_ms();
    rusage_times(after, npids);
    gpu_times(accel, after, npids);
    double dt = (t_after - t_before) / 1000.0;

    printf("{\"t\":%.0f,\"dt\":%.4f,\"soc\":", t_after, dt);
    if (soc_before && soc_after) {
      CFDictionaryRef delta = IOReportCreateSamplesDelta(soc_before, soc_after, NULL);
      CFArrayRef items = delta ? CFDictionaryGetValue(delta, CFSTR("IOReportChannels")) : NULL;
      putchar('{');
      int first = 1;
      for (CFIndex i = 0; items && i < CFArrayGetCount(items); i++) {
        CFDictionaryRef item = CFArrayGetValueAtIndex(items, i);
        CFStringRef unit = IOReportChannelGetUnitLabel(item);
        char ubuf[16] = "";
        if (unit) CFStringGetCString(unit, ubuf, sizeof ubuf, kCFStringEncodingUTF8);
        double scale = 0;  // to millijoules
        if (strcmp(ubuf, "mJ") == 0) scale = 1.0;
        else if (strcmp(ubuf, "uJ") == 0) scale = 1e-3;
        else if (strcmp(ubuf, "nJ") == 0) scale = 1e-6;
        else continue;
        double mw = (double)IOReportSimpleGetIntegerValue(item, 0) * scale / dt;
        if (!first) putchar(',');
        first = 0;
        json_string(IOReportChannelGetChannelName(item));
        printf(":%.1f", mw);
      }
      putchar('}');
      if (delta) CFRelease(delta);
    } else {
      printf("null");
    }
    putchar(',');
    print_gpu_util(accel);
    printf(",\"procs\":{");
    for (int i = 0; i < npids; i++) {
      if (i) putchar(',');
      double gpu_ms = after[i].gpu_ns >= before[i].gpu_ns
                          ? (double)(after[i].gpu_ns - before[i].gpu_ns) / 1e6
                          : 0.0;
      printf("\"%d\":{\"gpu_ms\":%.2f", after[i].pid, gpu_ms);
      if (after[i].rusage_ok && before[i].rusage_ok) {
        double cpu_ms =
            (double)(after[i].cpu_ticks - before[i].cpu_ticks) * tb.numer / tb.denom / 1e6;
        double energy_mj = (double)(after[i].energy_nj - before[i].energy_nj) / 1e6;
        printf(",\"cpu_ms\":%.2f,\"energy_mj\":%.3f,\"idle_wakeups\":%llu,\"intr_wakeups\":%llu",
               cpu_ms, energy_mj,
               (unsigned long long)(after[i].idle_wakeups - before[i].idle_wakeups),
               (unsigned long long)(after[i].intr_wakeups - before[i].intr_wakeups));
      } else if (!after[i].rusage_ok) {
        printf(",\"rusage\":false");
      }
      putchar('}');
    }
    printf("}}\n");
    fflush(stdout);

    if (soc_before) CFRelease(soc_before);
    soc_before = soc_after;
    t_before = t_after;
    memcpy(before, after, sizeof(ProcSample) * (size_t)npids);
  }
  if (soc_before) CFRelease(soc_before);
  if (accel) IOObjectRelease(accel);
  return 0;
}
