class BotsController < ApplicationController
  before_action :authenticate_user!, except: [:skill_md]
  before_action :set_bot, only: [:show, :edit, :update, :destroy, :chat, :unbind_rokid, :generate_skill_token]

  def index
    @bots = current_user.bots.order(created_at: :desc)
  end

  def show
    @bot_sessions = @bot.bot_sessions.order(connected_at: :desc).limit(10)
  end

  def chat
    # Chat interface for testing bot
    # 获取第一个活跃的 Access Key 用于 SSE 认证
    @access_key = AccessKey.where(is_active: true).first&.key
    unless @access_key
      flash.now[:alert] = '未找到可用的 Access Key，请先在管理后台创建。'
    end
  end

  def new
    @bot = current_user.bots.build
  end

  def create
    @bot = current_user.bots.build(bot_params)
    
    if @bot.save
      redirect_to bot_path(@bot), notice: 'Bot created successfully.'
    else
      render :new, status: :unprocessable_entity
    end
  end

  def edit
  end

  def update
    if @bot.update(bot_params)
      redirect_to bot_path(@bot), notice: 'Bot updated successfully.'
    else
      render :edit, status: :unprocessable_entity
    end
  end

  def destroy
    @bot.destroy
    redirect_to bots_path, notice: 'Bot deleted successfully.'
  end

  def unbind_rokid
    if @bot.update(rokid_device_id: nil, rokid_user_id: nil)
      redirect_to bot_path(@bot), notice: 'Rokid 绑定已解除，请重新扫码绑定。'
    else
      redirect_to bot_path(@bot), alert: '解除绑定失败，请稍后重试。'
    end
  end

  # SKILL.md for Claude Skill integration (requires valid token)
  def skill_md
    @bot = Bot.find(params[:id])
    
    # 验证 token
    token = params[:token]
    unless token.present?
      render plain: "Missing token. Please generate a binding link from bot settings.", status: :forbidden
      return
    end
    
    binding_token = @bot.binding_tokens.find_by(token: token)
    unless binding_token&.valid_for_binding?
      render plain: "Invalid or expired token. Please generate a new binding link from bot settings.", status: :forbidden
      return
    end
    
    # 标记 token 已使用（可选：也可以选择不标记，让它过期即可）
    # binding_token.mark_as_used!('skill') if binding_token.used_at.nil?
    
    @server_url = request.base_url
    render 'bots/skill_md', layout: false, content_type: 'text/plain'
  end

  # 生成 SKILL 绑定链接的 token
  def generate_skill_token
    # 创建新的临时 token（5分钟有效期）
    @binding_token = @bot.binding_tokens.create!
    
    # 返回带 token 的 URL
    @skill_url = skill_md_bot_url(@bot, token: @binding_token.token)
    
    # 直接渲染 Turbo Stream
    render 'bots/generate_skill_token', formats: :turbo_stream
  end

  private

  def set_bot
    @bot = current_user.bots.find(params[:id])
  end

  def bot_params
    params.require(:bot).permit(:name, :description, :webhook_url, :rokid_device_id, :config)
  end
end
