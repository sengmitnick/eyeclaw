import { Controller } from "@hotwired/stimulus"

// Connects to data-controller="rokid-binding"
// 功能：QR 码过期显示刷新按钮
export default class extends Controller {
  static targets = ["refreshButton"]
  static values = {
    expiresAt: String
  }
  
  declare readonly refreshButtonTarget: HTMLButtonElement
  declare readonly hasRefreshButtonTarget: boolean
  declare readonly expiresAtValue: string
  
  private expirationTimer?: number
  
  connect() {
    console.log("[RokidBinding] Controller connected")
    this.startExpirationTimer()
  }
  
  disconnect() {
    console.log("[RokidBinding] Controller disconnected")
    this.stopTimer()
  }
  
  // 开始过期倒计时
  startExpirationTimer() {
    const expiresAt = new Date(this.expiresAtValue)
    const now = new Date()
    const timeUntilExpiration = expiresAt.getTime() - now.getTime()
    
    if (timeUntilExpiration > 0) {
      this.expirationTimer = window.setTimeout(() => {
        this.showRefreshButton()
      }, timeUntilExpiration)
    } else {
      // 已过期
      this.showRefreshButton()
    }
  }
  
  // 显示刷新按钮
  showRefreshButton() {
    if (this.hasRefreshButtonTarget) {
      this.refreshButtonTarget.classList.remove('hidden')
    }
  }
  
  // 刷新页面（重新生成二维码）
  refresh() {
    console.log("[RokidBinding] Refreshing QR code...")
    window.location.reload()
  }
  
  // 停止定时器
  stopTimer() {
    if (this.expirationTimer) {
      clearTimeout(this.expirationTimer)
      this.expirationTimer = undefined
    }
  }
}
