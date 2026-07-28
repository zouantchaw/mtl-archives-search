fn main() -> Result<(), Box<dyn std::error::Error>> {
    gate_h2_broker::supervisor::run_from_args()
}
