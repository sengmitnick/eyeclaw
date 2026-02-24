class Admin::AccessKeysController < Admin::BaseController
  before_action :set_access_key, only: [:show, :edit, :update, :destroy]

  def index
    @access_keys = AccessKey.page(params[:page]).per(10)
  end

  def show
  end

  def new
    @access_key = AccessKey.new
  end

  def create
    @access_key = AccessKey.new(access_key_params)

    if @access_key.save
      redirect_to admin_access_key_path(@access_key), notice: 'Access key was successfully created.'
    else
      render :new, status: :unprocessable_entity
    end
  end

  def edit
  end

  def update
    if @access_key.update(access_key_params)
      redirect_to admin_access_key_path(@access_key), notice: 'Access key was successfully updated.'
    else
      render :edit, status: :unprocessable_entity
    end
  end

  def destroy
    @access_key.destroy
    redirect_to admin_access_keys_path, notice: 'Access key was successfully deleted.'
  end

  private

  def set_access_key
    @access_key = AccessKey.find(params[:id])
  end

  def access_key_params
    params.require(:access_key).permit(:name, :description, :is_active)
  end
end
