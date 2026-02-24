class Admin::BotsController < Admin::BaseController
  before_action :set_bot, only: [:show, :edit, :update, :destroy]

  def index
    @bots = Bot.page(params[:page]).per(10)
  end

  def show
  end

  def new
    @bot = Bot.new
  end

  def create
    @bot = Bot.new(bot_params)

    if @bot.save
      redirect_to admin_bot_path(@bot), notice: 'Bot was successfully created.'
    else
      render :new, status: :unprocessable_entity
    end
  end

  def edit
  end

  def update
    if @bot.update(bot_params)
      redirect_to admin_bot_path(@bot), notice: 'Bot was successfully updated.'
    else
      render :edit, status: :unprocessable_entity
    end
  end

  def destroy
    @bot.destroy
    redirect_to admin_bots_path, notice: 'Bot was successfully deleted.'
  end

  private

  def set_bot
    @bot = Bot.find(params[:id])
  end

  def bot_params
    params.require(:bot).permit(:name, :description, :status, :webhook_url, :rokid_device_id, :config, :user_id)
  end
end
