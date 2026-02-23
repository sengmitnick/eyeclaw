class BotsController < ApplicationController
  before_action :authenticate_user!
  before_action :set_bot, only: [:show, :edit, :update, :destroy, :chat]

  def index
    @bots = current_user.bots.order(created_at: :desc)
  end

  def show
    @bot_sessions = @bot.bot_sessions.order(connected_at: :desc).limit(10)
  end

  def chat
    # Chat interface for testing bot
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

  private

  def set_bot
    @bot = current_user.bots.find(params[:id])
  end

  def bot_params
    params.require(:bot).permit(:name, :description, :webhook_url, :config)
  end
end
