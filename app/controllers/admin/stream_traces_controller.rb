class Admin::StreamTracesController < Admin::BaseController
  before_action :set_stream_trace, only: [:show, :edit, :update, :destroy]

  def index
    @stream_traces = StreamTrace.page(params[:page]).per(10)
  end

  def show
  end

  def new
    @stream_trace = StreamTrace.new
  end

  def create
    @stream_trace = StreamTrace.new(stream_trace_params)

    if @stream_trace.save
      redirect_to admin_stream_trace_path(@stream_trace), notice: 'Stream trace was successfully created.'
    else
      render :new, status: :unprocessable_entity
    end
  end

  def edit
  end

  def update
    if @stream_trace.update(stream_trace_params)
      redirect_to admin_stream_trace_path(@stream_trace), notice: 'Stream trace was successfully updated.'
    else
      render :edit, status: :unprocessable_entity
    end
  end

  def destroy
    @stream_trace.destroy
    redirect_to admin_stream_traces_path, notice: 'Stream trace was successfully deleted.'
  end

  private

  def set_stream_trace
    @stream_trace = StreamTrace.find(params[:id])
  end

  def stream_trace_params
    params.require(:stream_trace).permit(:trace_id, :message_id, :agent_id, :status, :events, :sdk_content, :sse_content, :sdk_chunk_count, :sse_chunk_count, :anomaly, :bot_id)
  end
end
