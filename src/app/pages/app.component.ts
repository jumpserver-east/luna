import { Component, OnDestroy, OnInit } from "@angular/core";
import { I18nService, SettingService } from "@app/services";
import { EventManager } from "@angular/platform-browser";
import { useTheme } from "@src/sass/theme/util";
import { User } from "@app/globals";
import deviceMonitor from "@app/utils/deviceMonitor";

@Component({
  standalone: false,
  selector: "app-root",
  templateUrl: "app.component.html",
  styleUrls: ["app.component.css"],
})
export class AppComponent implements OnInit, OnDestroy {
  private deviceMonitorTimer: any = null;

  constructor(
    _i18n: I18nService,
    private eventManager: EventManager,
    _setting: SettingService
  ) {}

  ngOnInit(): void {
    const { initTheme } = useTheme();
    initTheme();
    this.eventManager.addEventListener(window as unknown as HTMLElement, "keyup.esc", () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      }
    });
    this.watchDeviceMonitor();
  }

  ngOnDestroy(): void {
    if (this.deviceMonitorTimer) {
      clearInterval(this.deviceMonitorTimer);
      this.deviceMonitorTimer = null;
    }
    deviceMonitor.stop();
  }

  // 用户登录后启动 UKey 设备监控，登出或退出时停止。
  private watchDeviceMonitor(): void {
    let lastLogined = false;
    const sync = () => {
      const logined = !!(User.logined && User.username);
      if (logined === lastLogined) {
        return;
      }
      lastLogined = logined;
      if (logined) {
        deviceMonitor.start();
      } else {
        deviceMonitor.stop();
      }
    };
    sync();
    this.deviceMonitorTimer = setInterval(sync, 1000);
  }
}
