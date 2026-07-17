import { withSitePrefix } from '@app/utils/path';

const DEVICE_URL = 'https://127.0.0.1:51245/alpha';
const POLL_INTERVAL = 2 * 1000;
const REQUEST_TIMEOUT = 1500;
const REQUEST_BODY = `json=${encodeURIComponent(JSON.stringify({ function: 'SOF_EnumDevice' }))}`;

interface DeviceResponse {
  data?: any;
}

interface DeviceRequest {
  post(url: string, body: any, options?: any): Promise<DeviceResponse>;
}

interface CreateDeviceMonitorOptions {
  request?: DeviceRequest;
  onDeviceError?: () => void;
  setTimer?: (handler: () => void, interval: number) => any;
  clearTimer?: (handle: any) => void;
}

function logout(): void {
  window.location.href = withSitePrefix('/core/auth/logout/');
}

// 默认请求实现：用原生 fetch 请求本地设备服务，并对齐 { data } 的返回形态，附带超时控制。
const defaultRequest: DeviceRequest = {
  async post(url: string, body: any, options: any = {}): Promise<DeviceResponse> {
    const controller = new AbortController();
    const timeout = options.timeout || REQUEST_TIMEOUT;
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        body,
        headers: options.headers,
        signal: controller.signal
      });

      const text = await response.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = undefined;
      }
      return { data };
    } finally {
      clearTimeout(timer);
    }
  }
};

export function createDeviceMonitor({
  request = defaultRequest,
  onDeviceError = logout,
  setTimer = setInterval,
  clearTimer = clearInterval
}: CreateDeviceMonitorOptions = {}) {
  let timer: any = null;
  let requestInFlight = false;
  let running = false;
  let runId = 0;

  function hasDeviceError(data: any): boolean {
    if (!data || !Object.prototype.hasOwnProperty.call(data, 'errorCode')) {
      return false;
    }

    const errorCode = Number(data.errorCode);
    return !isNaN(errorCode) && errorCode !== 0;
  }

  function stop(): void {
    running = false;
    runId += 1;
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
  }

  async function poll(): Promise<void> {
    if (!running || requestInFlight) {
      return;
    }

    const currentRunId = runId;
    requestInFlight = true;
    try {
      let responseData: any;
      try {
        const response = await request.post(DEVICE_URL, REQUEST_BODY, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: REQUEST_TIMEOUT
        });
        responseData = response.data;
      } catch (error) {
        responseData = (error as any)?.response?.data;
      }

      if (running && currentRunId === runId && hasDeviceError(responseData)) {
        stop();
        onDeviceError();
      }
    } finally {
      requestInFlight = false;
    }
  }

  function start(): void {
    if (running) {
      return;
    }

    running = true;
    runId += 1;
    timer = setTimer(poll, POLL_INTERVAL);
    poll();
  }

  return { start, stop, poll };
}

const deviceMonitor = createDeviceMonitor();

export default deviceMonitor;
